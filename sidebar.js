(function () {
  const appShell = document.getElementById("app-shell");
  const collapseBtn = document.getElementById("sidebar-collapse");
  const pills = Array.from(document.querySelectorAll("#doc-type-pills .pill"));

  const COLLAPSED_STORAGE_KEY = "fdv.sidebarCollapsed";

  collapseBtn.addEventListener("click", () => {
    const collapsed = appShell.classList.toggle("sidebar-collapsed");
    collapseBtn.setAttribute("aria-expanded", String(!collapsed));
    collapseBtn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "");
    } catch (e) {}
  });

  try {
    if (localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1") {
      appShell.classList.add("sidebar-collapsed");
      collapseBtn.setAttribute("aria-expanded", "false");
      collapseBtn.setAttribute("aria-label", "Expand sidebar");
    }
  } catch (e) {}

  let activeFilter = "all";

  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.dataset.type;
      document.dispatchEvent(new CustomEvent("fdv:filterchange"));
    });
  });

  // Returns null for "show every category" or an array of category names
  // to restrict the dashboard to.
  window.getCategoryFilter = function getCategoryFilter() {
    return activeFilter === "all" ? null : activeFilter.split(",");
  };
})();
