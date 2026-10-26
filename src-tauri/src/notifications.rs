// Native macOS notifications via UNUserNotificationCenter (objc2).
//
// tauri-plugin-notification can't do this job: its desktop backend
// (notify-rust) is fire-and-forget — no click callback on macOS.
// UNUserNotificationCenter is event-driven: a delegate's
// didReceiveNotificationResponse fires when the user clicks a banner.
//
// The pane target rides in the notification's identifier
// ("periscope-route|{seq}|{target}") and is recovered there. The webview
// is a remote origin (localhost:17374) and can't invoke Rust commands, so
// both directions cross the Tauri event bus — the IPC surface core:default
// already grants it: "periscope:notify" carries a banner in,
// "periscope:notification-clicked" carries a click back out.
//
// The webview's JS comes from the server and this shell from an installed
// .app, so either can be the older one. Everything past title/body/target
// is optional: an older webview's banner parses, and its click still goes
// out as the plain target on "periscope:notification-clicked". A banner that
// carries a `kind` keeps it (and what a click opens) in userInfo, and its
// click goes out as { target, kind, data } on
// "periscope:notification-opened", which an older webview never listens to.
//
// Buttons (2b): the webview registers the whole category set on
// "periscope:notify-categories" (when the feed starts and whenever the set
// changes, never per banner: registration is asynchronous and replaces the
// set, so a banner posted right behind one can show no buttons). A kinded
// banner names its category; a press goes out on
// "periscope:notification-action" as { target, kind, action, text, data }.
// This shell knows no kinds or buttons: they're data, so a new button needs
// new JS, not a new .app. An older shell drops the categories event and its
// banners carry no buttons; an older webview registers none.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use block2::{DynBlock, RcBlock};
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{
    NSArray, NSDictionary, NSError, NSObject, NSObjectProtocol, NSSet, NSString,
};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationCategory, UNNotificationCategoryOptions,
    UNNotificationContent, UNNotificationDefaultActionIdentifier,
    UNNotificationDismissActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNTextInputNotificationAction,
    UNTextInputNotificationResponse, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter, Listener};

/// Webview → Rust: post this banner.
const NOTIFY_EVENT: &str = "periscope:notify";
/// Rust → webview: the pane behind this banner was clicked (a banner without a kind).
const CLICK_EVENT: &str = "periscope:notification-clicked";
/// Rust → webview: a banner with a kind was clicked: { target, kind, data }.
const OPENED_EVENT: &str = "periscope:notification-opened";
/// Webview → Rust: the whole category set (each kind's buttons), replacing the last.
const CATEGORIES_EVENT: &str = "periscope:notify-categories";
/// Rust → webview: a button on a kinded banner: { target, kind, action, text, data }.
const ACTION_EVENT: &str = "periscope:notification-action";
/// Notification identifier shape. The seq keeps ids unique (a reused id
/// silently replaces the prior banner); the pane target is the tail,
/// recovered verbatim on click — `split_once` keeps any '|' inside it.
const ID_PREFIX: &str = "periscope-route|";
/// The userInfo key holding a kinded banner's `Info`, as JSON.
const INFO_KEY: &str = "periscope";

static SEQ: AtomicUsize = AtomicUsize::new(0);

/// Whether the dashboard window has focus, kept by main.rs's window events.
/// will_present runs on a thread UNUserNotificationCenter chooses, and only
/// while the app is frontmost; an atomic kept from window events answers
/// without a round trip to the main thread.
static FOCUSED: AtomicBool = AtomicBool::new(false);

pub fn set_focused(focused: bool) {
    FOCUSED.store(focused, Ordering::Relaxed);
}

/// `#[serde(default)]` alone only covers a *missing* field — `"subtitle":
/// null` still deserializes to `None`/unit and fails the `String` field,
/// dropping the whole banner. This shell outlives the JS it talks to, so a
/// null from an older or newer webview must still parse. Missing keeps using
/// `default` (the empty string); present-but-null is mapped here.
fn null_to_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(<Option<String> as serde::Deserialize>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(serde::Deserialize, Debug)]
struct NotifyRequest {
    title: String,
    body: String,
    #[serde(default, deserialize_with = "null_to_default")]
    target: String,
    #[serde(default, deserialize_with = "null_to_default")]
    kind: String,
    #[serde(default, deserialize_with = "null_to_default")]
    subtitle: String,
    #[serde(default, deserialize_with = "null_to_default")]
    thread: String,
    #[serde(default, deserialize_with = "null_to_default")]
    category: String,
    #[serde(default)]
    data: serde_json::Value,
    #[serde(default)]
    quiet_when_focused: bool,
}

/// What a kinded banner keeps in userInfo, for its click and its presentation.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
struct Info {
    target: String,
    kind: String,
    #[serde(default)]
    data: serde_json::Value,
    #[serde(default)]
    quiet_when_focused: bool,
}

fn parse_request(payload: &str) -> Result<NotifyRequest, serde_json::Error> {
    serde_json::from_str(payload)
}

fn info_json(req: &NotifyRequest) -> String {
    serde_json::to_string(&Info {
        target: req.target.clone(),
        kind: req.kind.clone(),
        data: req.data.clone(),
        quiet_when_focused: req.quiet_when_focused,
    })
    .expect("Info always serializes")
}

fn parse_info(json: &str) -> Option<Info> {
    serde_json::from_str::<Info>(json)
        .ok()
        .filter(|i| !i.kind.is_empty())
}

/// `send()`'s userInfo: `None` for a plain banner (no `kind`), which keeps an
/// old webview's click on the legacy `CLICK_EVENT` with just the target;
/// `Some` for a kinded banner, which rides `OPENED_EVENT` instead.
fn user_info_json(req: &NotifyRequest) -> Option<String> {
    if req.kind.is_empty() {
        None
    } else {
        Some(info_json(req))
    }
}

/// The category a banner's buttons come from: its own, else its kind's. `None`
/// for a plain banner, so an older webview's banner never grows buttons.
fn category_of(req: &NotifyRequest) -> Option<&str> {
    if req.kind.is_empty() {
        None
    } else if req.category.is_empty() {
        Some(&req.kind)
    } else {
        Some(&req.category)
    }
}

/// A text-input button's labels (UNTextInputNotificationAction).
#[derive(serde::Deserialize, Debug, PartialEq)]
struct ReplySpec {
    #[serde(default, deserialize_with = "null_to_default")]
    button: String,
    #[serde(default, deserialize_with = "null_to_default")]
    placeholder: String,
}

/// One button, as the webview describes it. The flags are `Option` so a null
/// from a newer or older webview reads as unset rather than failing the button.
#[derive(serde::Deserialize, Debug, PartialEq)]
struct ActionSpec {
    #[serde(default, deserialize_with = "null_to_default")]
    id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    title: String,
    #[serde(default)]
    auth: Option<bool>,
    #[serde(default)]
    foreground: Option<bool>,
    #[serde(default)]
    destructive: Option<bool>,
    #[serde(default)]
    reply: Option<ReplySpec>,
}

impl ActionSpec {
    /// `auth`: Touch ID / password before it runs from a locked screen.
    /// `foreground`: bring Periscope forward. `destructive`: drawn red.
    fn options(&self) -> UNNotificationActionOptions {
        let mut bits = 0;
        if self.auth == Some(true) {
            bits |= UNNotificationActionOptions::AuthenticationRequired.0;
        }
        if self.foreground == Some(true) {
            bits |= UNNotificationActionOptions::Foreground.0;
        }
        if self.destructive == Some(true) {
            bits |= UNNotificationActionOptions::Destructive.0;
        }
        UNNotificationActionOptions(bits)
    }
}

#[derive(Debug, PartialEq)]
struct CategorySpec {
    id: String,
    actions: Vec<ActionSpec>,
}

/// The categories the webview asked for, keeping what's usable: a category
/// needs an id, a button an id and a title. A bad button is dropped, not its
/// category, so a field this shell can't read costs as little as possible.
/// `Err` only when the payload isn't a JSON list at all.
fn category_specs(payload: &str) -> Result<Vec<CategorySpec>, serde_json::Error> {
    let raw: Vec<serde_json::Value> = serde_json::from_str(payload)?;
    Ok(raw
        .into_iter()
        .filter_map(|c| {
            let id = c.get("id")?.as_str()?.to_string();
            if id.is_empty() {
                return None;
            }
            let actions = c
                .get("actions")
                .and_then(|a| a.as_array())
                .map(|list| {
                    list.iter()
                        .filter_map(|v| serde_json::from_value::<ActionSpec>(v.clone()).ok())
                        .filter(|a| !a.id.is_empty() && !a.title.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            Some(CategorySpec { id, actions })
        })
        .collect())
}

/// What a button press tells the webview: the banner's context plus which
/// button, and the text typed into a reply button ("" for any other).
fn action_payload(info: &Info, action: &str, text: &str) -> serde_json::Value {
    serde_json::json!({
        "target": info.target, "kind": info.kind, "action": action, "text": text, "data": info.data
    })
}

/// The pane target out of a notification identifier (`ID_PREFIX + seq + "|" +
/// target`), keeping any '|' inside the target itself. `None` for an id this
/// shell never minted.
fn target_from_id(id: &str) -> Option<&str> {
    id.strip_prefix(ID_PREFIX)
        .and_then(|rest| rest.split_once('|'))
        .map(|(_seq, target)| target)
}

/// Banner and sound, unless the banner asked to stay quiet while the dashboard
/// is focused and it is. Either way it's listed in Notification Center (the
/// `List` option: with no options at all, macOS drops it there too, and what
/// you looked past while focused is gone).
fn should_present(quiet_when_focused: bool, focused: bool) -> bool {
    !(quiet_when_focused && focused)
}

fn info_of(content: &UNNotificationContent) -> Option<Info> {
    let value = content
        .userInfo()
        .objectForKey(&NSString::from_str(INFO_KEY))?;
    parse_info(&value.downcast::<NSString>().ok()?.to_string())
}

struct Ivars {
    app: AppHandle,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "PeriscopeUNDelegate"]
    #[ivars = Ivars]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        // Fired when the user clicks (or actions) a delivered notification.
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &DynBlock<dyn Fn()>,
        ) {
            let request = response.notification().request();
            if let Some(info) = info_of(&request.content()) {
                let action = response.actionIdentifier();
                let default = unsafe { UNNotificationDefaultActionIdentifier };
                let dismiss = unsafe { UNNotificationDismissActionIdentifier };
                if action.isEqualToString(default) {
                    let _ = self.ivars().app.emit(
                        OPENED_EVENT,
                        serde_json::json!({
                            "target": info.target, "kind": info.kind, "data": info.data
                        }),
                    );
                } else if !action.isEqualToString(dismiss) {
                    // A reply button's response is the text-input subclass.
                    let text = response
                        .downcast_ref::<UNTextInputNotificationResponse>()
                        .map(|r| r.userText().to_string())
                        .unwrap_or_default();
                    let _ = self.ivars().app.emit(
                        ACTION_EVENT,
                        action_payload(&info, &action.to_string(), &text),
                    );
                }
            } else {
                let id = request.identifier().to_string();
                if let Some(target) = target_from_id(&id) {
                    let _ = self.ivars().app.emit(CLICK_EVENT, target);
                }
            }
            completion_handler.call(());
        }

        // Fired when a notification arrives while Periscope is frontmost.
        // Present it explicitly, else macOS swallows the banner.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            notification: &UNNotification,
            completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let quiet =
                info_of(&notification.request().content()).is_some_and(|i| i.quiet_when_focused);
            let options = if should_present(quiet, FOCUSED.load(Ordering::Relaxed)) {
                UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound
            } else {
                UNNotificationPresentationOptions::List
            };
            completion_handler.call((options,));
        }
    }
);

impl Delegate {
    fn new(app: AppHandle) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Ivars { app });
        unsafe { msg_send![super(this), init] }
    }
}

/// Install the notification delegate, request authorization, and start
/// listening for banner requests from the webview. Call once, from the
/// Tauri `setup` hook of the bundled app — UNUserNotificationCenter throws
/// if used from a non-bundled binary.
pub fn init(app: &AppHandle) {
    let center = UNUserNotificationCenter::currentNotificationCenter();

    let delegate = Delegate::new(app.clone());
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // setDelegate keeps only a weak reference — leak our single delegate
    // so it lives for the app's lifetime and keeps receiving clicks.
    std::mem::forget(delegate);

    let auth = RcBlock::new(|granted: Bool, _err: *mut NSError| {
        if !granted.as_bool() {
            crate::recycle::shell_log("periscope: notification permission not granted");
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &auth,
    );

    app.listen(NOTIFY_EVENT, |event| match parse_request(event.payload()) {
        Ok(req) => send(&req),
        Err(e) => crate::recycle::shell_log(&format!("periscope: bad notify payload: {e}")),
    });

    app.listen(CATEGORIES_EVENT, |event| {
        match category_specs(event.payload()) {
            Ok(specs) => register_categories(&specs),
            Err(e) => crate::recycle::shell_log(&format!("periscope: bad categories payload: {e}")),
        }
    });
}

/// Replace the whole category set. macOS keeps only the last set, and a
/// banner naming a category that isn't in it shows no buttons.
fn register_categories(specs: &[CategorySpec]) {
    autoreleasepool(|_| {
        let categories: Vec<Retained<UNNotificationCategory>> = specs
            .iter()
            .map(|c| {
                let actions: Vec<Retained<UNNotificationAction>> = c
                    .actions
                    .iter()
                    .map(|a| {
                        let id = NSString::from_str(&a.id);
                        let title = NSString::from_str(&a.title);
                        match &a.reply {
                            Some(r) => {
                                let button = if r.button.is_empty() { "Send" } else { &r.button };
                                let text_action = UNTextInputNotificationAction::actionWithIdentifier_title_options_textInputButtonTitle_textInputPlaceholder(
                                    &id,
                                    &title,
                                    a.options(),
                                    &NSString::from_str(button),
                                    &NSString::from_str(&r.placeholder),
                                );
                                Retained::into_super(text_action)
                            }
                            None => UNNotificationAction::actionWithIdentifier_title_options(
                                &id,
                                &title,
                                a.options(),
                            ),
                        }
                    })
                    .collect();
                UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                    &NSString::from_str(&c.id),
                    &NSArray::from_retained_slice(&actions),
                    &NSArray::new(),
                    UNNotificationCategoryOptions(0),
                )
            })
            .collect();
        UNUserNotificationCenter::currentNotificationCenter()
            .setNotificationCategories(&NSSet::from_retained_slice(&categories));
    });
}

fn send(req: &NotifyRequest) {
    autoreleasepool(|_| {
        let center = UNUserNotificationCenter::currentNotificationCenter();

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&req.title));
        if !req.subtitle.is_empty() {
            content.setSubtitle(&NSString::from_str(&req.subtitle));
        }
        content.setBody(&NSString::from_str(&req.body));
        // macOS stacks banners that share a thread.
        if !req.thread.is_empty() {
            content.setThreadIdentifier(&NSString::from_str(&req.thread));
        }
        // The category's buttons (registered separately, see register_categories).
        if let Some(category) = category_of(req) {
            content.setCategoryIdentifier(&NSString::from_str(category));
        }
        if let Some(json) = user_info_json(req) {
            let key = NSString::from_str(INFO_KEY);
            let value = NSString::from_str(&json);
            let info = NSDictionary::from_slices(&[&*key], &[&*value]);
            // userInfo is an untyped NSDictionary; ours holds one string under one string key.
            unsafe { content.setUserInfo(info.cast_unchecked::<AnyObject, AnyObject>()) };
        }

        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let ident = NSString::from_str(&format!("{ID_PREFIX}{seq}|{}", req.target));
        let request =
            UNNotificationRequest::requestWithIdentifier_content_trigger(&ident, &content, None);

        let done = RcBlock::new(|err: *mut NSError| {
            if !err.is_null() {
                crate::recycle::shell_log("periscope: notification delivery failed");
            }
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&done));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL: &str = r#"{"title":"CI failed on #7","body":"✗ test","target":"s:1","kind":"ci_failed",
        "subtitle":"periscope · pane","thread":"ci_failed","data":{"open":"url","url":"https://github.com/o/r/pull/7"},
        "quiet_when_focused":true}"#;

    #[test]
    fn parses_an_older_webviews_banner() {
        let req = parse_request(r#"{"title":"t","body":"b","target":"s:1"}"#).unwrap();
        assert_eq!(req.target, "s:1");
        assert_eq!(req.kind, "");
        assert!(req.subtitle.is_empty() && req.thread.is_empty());
        assert!(req.data.is_null());
        assert!(!req.quiet_when_focused);
    }

    #[test]
    fn parses_a_full_banner() {
        let req = parse_request(FULL).unwrap();
        assert_eq!(req.kind, "ci_failed");
        assert_eq!(req.subtitle, "periscope · pane");
        assert_eq!(req.thread, "ci_failed");
        assert_eq!(req.data["url"], "https://github.com/o/r/pull/7");
        assert!(req.quiet_when_focused);
    }

    #[test]
    fn rejects_a_banner_without_a_title() {
        assert!(parse_request(r#"{"body":"b","target":"s:1"}"#).is_err());
    }

    #[test]
    fn keeps_what_a_click_needs_in_user_info() {
        let req = parse_request(FULL).unwrap();
        let info = parse_info(&info_json(&req)).unwrap();
        assert_eq!(
            info,
            Info {
                target: "s:1".into(),
                kind: "ci_failed".into(),
                data: serde_json::json!({"open": "url", "url": "https://github.com/o/r/pull/7"}),
                quiet_when_focused: true,
            }
        );
    }

    #[test]
    fn treats_user_info_without_a_kind_as_a_plain_banner() {
        assert!(parse_info(r#"{"target":"s:1","kind":""}"#).is_none());
        assert!(parse_info("not json").is_none());
    }

    #[test]
    fn stays_quiet_only_when_asked_and_focused() {
        assert!(should_present(false, false));
        assert!(should_present(false, true));
        assert!(should_present(true, false));
        assert!(!should_present(true, true));
    }

    #[test]
    fn tolerates_null_for_fields_that_default_to_empty() {
        // `#[serde(default)]` alone only covers a missing field — an explicit
        // null (an older or newer webview sending one) must not drop the banner.
        let req = parse_request(
            r#"{"title":"t","body":"b","target":null,"subtitle":null,"kind":null,"thread":null}"#,
        )
        .unwrap();
        assert_eq!(req.target, "");
        assert_eq!(req.kind, "");
        assert_eq!(req.subtitle, "");
        assert_eq!(req.thread, "");
    }

    #[test]
    fn parses_a_banner_with_fields_this_shell_does_not_know() {
        // The forward-compatibility half of the version-skew contract: a newer
        // webview's 2b fields (reply, actions) must not fail an older shell.
        let req = parse_request(
            r#"{"title":"t","body":"b","target":"s:1",
                "reply":true,"actions":[{"id":"allow","title":"Allow"}]}"#,
        )
        .unwrap();
        assert_eq!(req.target, "s:1");
    }

    #[test]
    fn parse_info_defaults_missing_data_and_quiet_when_focused() {
        let info = parse_info(r#"{"target":"s:1","kind":"done"}"#).unwrap();
        assert_eq!(info.data, serde_json::Value::Null);
        assert!(!info.quiet_when_focused);
    }

    #[test]
    fn user_info_json_is_none_without_a_kind() {
        let req = parse_request(r#"{"title":"t","body":"b","target":"s:1"}"#).unwrap();
        assert!(user_info_json(&req).is_none());
    }

    #[test]
    fn user_info_json_carries_the_info_with_a_kind() {
        let req = parse_request(FULL).unwrap();
        let info = parse_info(&user_info_json(&req).unwrap()).unwrap();
        assert_eq!(info.kind, "ci_failed");
    }

    #[test]
    fn target_from_id_keeps_a_pipe_inside_the_target() {
        assert_eq!(
            target_from_id("periscope-route|3|s:1|extra"),
            Some("s:1|extra")
        );
    }

    #[test]
    fn target_from_id_rejects_a_foreign_id() {
        assert_eq!(
            target_from_id("com.apple.UNNotificationDefaultActionIdentifier"),
            None
        );
    }

    #[test]
    fn category_specs_keeps_every_usable_action() {
        let specs = category_specs(
            r#"[
            {"id":"done","actions":[{"id":"review","title":"Review diff","foreground":true},
                                    {"id":"mark_seen","title":"Mark seen"}]},
            {"id":"question","actions":[{"id":"send","title":"Reply","auth":true,
                                         "reply":{"button":"Send","placeholder":"Reply…"}}]}
        ]"#,
        )
        .unwrap();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].id, "done");
        let ids: Vec<&str> = specs[0].actions.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, ["review", "mark_seen"]);
        assert_eq!(
            specs[0].actions[0].options().0,
            UNNotificationActionOptions::Foreground.0
        );
        assert_eq!(specs[0].actions[1].options().0, 0);
        assert_eq!(
            specs[1].actions[0].options().0,
            UNNotificationActionOptions::AuthenticationRequired.0
        );
        assert_eq!(
            specs[1].actions[0].reply,
            Some(ReplySpec {
                button: "Send".into(),
                placeholder: "Reply…".into()
            })
        );
    }

    #[test]
    fn category_specs_drops_a_bad_action_not_its_category() {
        // The shell outlives the JS that sends this: an action it can't read
        // costs that one button, never the category's other buttons.
        let specs = category_specs(
            r#"[{"id":"done","actions":[{"id":"","title":"x"},{"title":"no id"},
                                        {"id":"ok","title":"OK"},{"id":"bad","title":5}]},
                {"actions":[]},
                {"id":"empty"}]"#,
        )
        .unwrap();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].actions.len(), 1);
        assert_eq!(specs[0].actions[0].id, "ok");
        assert_eq!(specs[1].id, "empty");
        assert!(specs[1].actions.is_empty());
    }

    #[test]
    fn category_specs_tolerates_nulls() {
        let specs = category_specs(
            r#"[{"id":"d","actions":[{"id":"a","title":"A","auth":null,"foreground":null,
                                      "destructive":null,"reply":null}]}]"#,
        )
        .unwrap();
        assert_eq!(specs[0].actions[0].options().0, 0);
        assert!(specs[0].actions[0].reply.is_none());
    }

    #[test]
    fn category_specs_rejects_a_payload_that_is_not_a_list() {
        assert!(category_specs(r#"{"id":"done"}"#).is_err());
    }

    #[test]
    fn action_options_combine() {
        let specs = category_specs(
            r#"[{"id":"d","actions":[{"id":"a","title":"A","auth":true,"destructive":true}]}]"#,
        )
        .unwrap();
        assert_eq!(
            specs[0].actions[0].options().0,
            UNNotificationActionOptions::AuthenticationRequired.0
                | UNNotificationActionOptions::Destructive.0
        );
    }

    #[test]
    fn a_kinded_banner_names_its_category_defaulting_to_its_kind() {
        assert_eq!(
            category_of(&parse_request(FULL).unwrap()),
            Some("ci_failed")
        );
        let named =
            parse_request(r#"{"title":"t","body":"b","kind":"done","category":"done_seen"}"#)
                .unwrap();
        assert_eq!(category_of(&named), Some("done_seen"));
        // A plain banner (an older webview's) carries no category, so no buttons.
        let plain =
            parse_request(r#"{"title":"t","body":"b","target":"s:1","category":"done"}"#).unwrap();
        assert_eq!(category_of(&plain), None);
        let null =
            parse_request(r#"{"title":"t","body":"b","kind":"done","category":null}"#).unwrap();
        assert_eq!(category_of(&null), Some("done"));
    }

    #[test]
    fn a_button_press_carries_the_banner_context_and_the_typed_text() {
        let info = Info {
            target: "s:1".into(),
            kind: "question".into(),
            data: serde_json::json!({"pid": "p1"}),
            quiet_when_focused: false,
        };
        assert_eq!(
            action_payload(&info, "send", "yes please"),
            serde_json::json!({"target": "s:1", "kind": "question", "action": "send",
                               "text": "yes please", "data": {"pid": "p1"}})
        );
    }
}
