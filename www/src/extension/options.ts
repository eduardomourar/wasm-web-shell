/**
 * Extension options page.
 *
 * A minimal settings surface for the handful of preferences the content
 * script reads from chrome.storage.local:
 * - "Always start collapsed": ignore the persisted last collapsed/expanded
 *   state and always start collapsed on page load.
 * - "Default region override": used as the shell's default region instead
 *   of the one parsed from the Console hostname (or the noflush_Region
 *   cookie), for cases where neither is correct.
 * - "Reset panel size": clears the persisted drag-resized height.
 */

const STORAGE_KEY_ALWAYS_COLLAPSED = "wasmShellAlwaysCollapsed";
const STORAGE_KEY_REGION_OVERRIDE = "wasmShellRegionOverride";
const STORAGE_KEY_HEIGHT = "wasmShellHeightPx";

const alwaysCollapsedInput = document.getElementById("always-collapsed") as HTMLInputElement;
const regionOverrideInput = document.getElementById("region-override") as HTMLInputElement;
const resetHeightButton = document.getElementById("reset-height") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;

const showSaved = () => {
  statusEl.textContent = "Saved.";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
};

const load = async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEY_ALWAYS_COLLAPSED, STORAGE_KEY_REGION_OVERRIDE]);
  alwaysCollapsedInput.checked = stored[STORAGE_KEY_ALWAYS_COLLAPSED] === true;
  regionOverrideInput.value = typeof stored[STORAGE_KEY_REGION_OVERRIDE] === "string" ? stored[STORAGE_KEY_REGION_OVERRIDE] : "";
};

alwaysCollapsedInput.addEventListener("change", () => {
  chrome.storage.local.set({ [STORAGE_KEY_ALWAYS_COLLAPSED]: alwaysCollapsedInput.checked }).then(showSaved);
});

regionOverrideInput.addEventListener("change", () => {
  chrome.storage.local.set({ [STORAGE_KEY_REGION_OVERRIDE]: regionOverrideInput.value.trim() }).then(showSaved);
});

resetHeightButton.addEventListener("click", () => {
  chrome.storage.local.remove(STORAGE_KEY_HEIGHT).then(showSaved);
});

load();
