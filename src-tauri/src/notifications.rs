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

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use block2::{DynBlock, RcBlock};
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{NSDictionary, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationContent,
    UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter, Listener};

/// Webview → Rust: post this banner.
const NOTIFY_EVENT: &str = "periscope:notify";
/// Rust → webview: the pane behind this banner was clicked (a banner without a kind).
const CLICK_EVENT: &str = "periscope:notification-clicked";
/// Rust → webview: a banner with a kind was clicked: { target, kind, data }.
const OPENED_EVENT: &str = "periscope:notification-opened";
/// Notification identifier shape. The seq keeps ids unique (a reused id
/// silently replaces the prior banner); the pane target is the tail,
/// recovered verbatim on click — `split_once` keeps any '|' inside it.
const ID_PREFIX: &str = "periscope-route|";
/// The userInfo key holding a kinded banner's `Info`, as JSON.
const INFO_KEY: &str = "periscope";

static SEQ: AtomicUsize = AtomicUsize::new(0);

/// Whether the dashboard window has focus, kept by main.rs's window events.
/// will_present reads this rather than asking the window: it runs on the main
/// thread, where a synchronous window query can deadlock.
static FOCUSED: AtomicBool = AtomicBool::new(false);

pub fn set_focused(focused: bool) {
    FOCUSED.store(focused, Ordering::Relaxed);
}

#[derive(serde::Deserialize, Debug)]
struct NotifyRequest {
    title: String,
    body: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    thread: String,
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
    .unwrap_or_default()
}

fn parse_info(json: &str) -> Option<Info> {
    serde_json::from_str::<Info>(json).ok().filter(|i| !i.kind.is_empty())
}

/// Banner and sound, unless the banner asked to stay quiet while the dashboard
/// is focused and it is. A quieted banner still lands in Notification Center.
fn should_present(quiet_when_focused: bool, focused: bool) -> bool {
    !(quiet_when_focused && focused)
}

fn info_of(content: &UNNotificationContent) -> Option<Info> {
    let value = content.userInfo().objectForKey(&NSString::from_str(INFO_KEY))?;
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
                let default = unsafe { UNNotificationDefaultActionIdentifier };
                if response.actionIdentifier().isEqualToString(default) {
                    let _ = self.ivars().app.emit(
                        OPENED_EVENT,
                        serde_json::json!({ "target": info.target, "kind": info.kind, "data": info.data }),
                    );
                }
            } else {
                let id = request.identifier().to_string();
                if let Some(target) = id
                    .strip_prefix(ID_PREFIX)
                    .and_then(|rest| rest.split_once('|'))
                    .map(|(_seq, target)| target)
                {
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
            let quiet = info_of(&notification.request().content()).is_some_and(|i| i.quiet_when_focused);
            let options = if should_present(quiet, FOCUSED.load(Ordering::Relaxed)) {
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::Sound
            } else {
                UNNotificationPresentationOptions::empty()
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
            eprintln!("periscope: notification permission not granted");
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &auth,
    );

    app.listen(NOTIFY_EVENT, |event| match parse_request(event.payload()) {
        Ok(req) => send(&req),
        Err(e) => eprintln!("periscope: bad notify payload: {e}"),
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
        if !req.kind.is_empty() {
            let key = NSString::from_str(INFO_KEY);
            let value = NSString::from_str(&info_json(req));
            let info = NSDictionary::from_slices(&[&*key], &[&*value]);
            // userInfo is an untyped NSDictionary; ours holds one string under one string key.
            unsafe { content.setUserInfo(&Retained::cast_unchecked::<NSDictionary>(info)) };
        }

        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let ident = NSString::from_str(&format!("{ID_PREFIX}{seq}|{}", req.target));
        let request =
            UNNotificationRequest::requestWithIdentifier_content_trigger(&ident, &content, None);

        let done = RcBlock::new(|err: *mut NSError| {
            if !err.is_null() {
                eprintln!("periscope: notification delivery failed");
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
}
