import get from "lodash.get";

import { useSettings } from "../contexts/SettingsContext";

function setPath<T extends object>(object: T, path: string, value: unknown): T {
  const keys = path.split(".");
  let current: Record<string, any> = object as Record<string, any>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    current[key] = { ...current[key] };
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
  return object;
}

/**
 * Helper to get and set nested settings that are saved in local storage
 * @param {string} path The path to the setting within the Settings object provided by the SettingsContext
 */
function useSetting<Type>(path: string): [Type, (value: Type) => void] {
  const { settings, setSettings } = useSettings();

  const setting = get(settings, path) as Type;

  const setSetting = (value: Type) =>
    setSettings((prev) => {
      const updated = setPath({ ...prev }, path, value);
      return updated;
    });

  return [setting, setSetting];
}

export default useSetting;
