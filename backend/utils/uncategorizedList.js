const UNCATEGORIZED_SYSTEM_KEY = "uncategorized";
const UNCATEGORIZED_LIST_NAME = "Uncategorized";

function buildUncategorizedList() {
  return {
    name: UNCATEGORIZED_LIST_NAME,
    description: "Auto-created list for uncategorized prayer requests",
    isSystem: true,
    systemKey: UNCATEGORIZED_SYSTEM_KEY,
    prayers: [],
  };
}

function isUncategorizedList(list) {
  if (!list) {
    return false;
  }

  const normalizedName = String(list.name || "").trim().toLowerCase();
  return list.systemKey === UNCATEGORIZED_SYSTEM_KEY || normalizedName === "uncategorized";
}

function findUncategorizedList(user) {
  if (!user?.prayerLists) {
    return null;
  }

  return user.prayerLists.find((list) => isUncategorizedList(list)) || null;
}

function ensureUncategorizedList(user) {
  let changed = false;
  let list = findUncategorizedList(user);

  if (!list) {
    user.prayerLists.push(buildUncategorizedList());
    list = user.prayerLists[user.prayerLists.length - 1];
    changed = true;
  }

  if (!list.isSystem) {
    list.isSystem = true;
    changed = true;
  }

  if (list.systemKey !== UNCATEGORIZED_SYSTEM_KEY) {
    list.systemKey = UNCATEGORIZED_SYSTEM_KEY;
    changed = true;
  }

  if (!String(list.name || "").trim()) {
    list.name = UNCATEGORIZED_LIST_NAME;
    changed = true;
  }

  return { list, changed };
}

module.exports = {
  UNCATEGORIZED_SYSTEM_KEY,
  UNCATEGORIZED_LIST_NAME,
  buildUncategorizedList,
  isUncategorizedList,
  findUncategorizedList,
  ensureUncategorizedList,
};
