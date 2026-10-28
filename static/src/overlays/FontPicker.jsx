// Settings → Fonts: the dashboard's UI face and its code face (paths, refs,
// the terminal). Saves on change, like the Tamagotchi picker. The UI list is
// the whole list, mono faces included — mono-everywhere is a pick.
import { FONTS } from "../fonts.js";
import { getFont, setFont } from "../prefs.js";

function Pick({ which, label, fonts }) {
  return (
    <label>
      {label}
      <select name={`font-${which}`} value={getFont(which).id} onChange={(e) => setFont(which, e.currentTarget.value)}>
        {fonts.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </label>
  );
}

export function FontPicker() {
  return (
    <fieldset class="font-picker">
      <legend>Fonts</legend>
      <Pick which="ui" label="Interface" fonts={FONTS} />
      <Pick which="code" label="Code &amp; terminal" fonts={FONTS.filter((f) => f.mono)} />
    </fieldset>
  );
}
