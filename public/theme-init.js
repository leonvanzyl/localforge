(() => {
  try {
    var saved = localStorage.getItem("localforge-theme");
    var theme = saved === "light" || saved === "dark" ? saved : "light";
    var el = document.documentElement;
    if (theme === "dark") {
      el.classList.add("dark");
    } else {
      el.classList.remove("dark");
    }
    el.setAttribute("data-theme", theme);
    el.style.colorScheme = theme;
  } catch (e) {}
})();
