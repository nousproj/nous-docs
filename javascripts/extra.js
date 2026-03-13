// Initialize Mermaid with readable sizing and dark/light theme support
document.addEventListener("DOMContentLoaded", function () {
  const isDark = document.body.getAttribute("data-md-color-scheme") === "slate";
  if (typeof mermaid !== "undefined") {
    mermaid.initialize({
      startOnLoad: true,
      theme: isDark ? "dark" : "default",
      securityLevel: "loose",
      fontFamily: "inherit",
      fontSize: 14,
      // Prevent mermaid from capping diagram width
      maxTextSize: 90000,
      flowchart: { useMaxWidth: false, htmlLabels: true },
      sequence:  { useMaxWidth: false, width: 180, height: 65 },
      gantt:     { useMaxWidth: false },
      er:        { useMaxWidth: false },
      stateDiagram: { useMaxWidth: false },
    });
  }

  // After mermaid renders, strip any inline max-width / width that it sets on
  // the SVG so our CSS can take full control of sizing.
  function unclampMermaidSVGs() {
    document.querySelectorAll(".mermaid svg").forEach(function (svg) {
      svg.style.maxWidth = "100%";
      svg.style.width    = "100%";
      svg.style.height   = "auto";
    });
  }

  // Run once after initial render (mermaid renders async)
  setTimeout(unclampMermaidSVGs, 600);

  // Re-initialize and re-clamp when theme changes
  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.attributeName === "data-md-color-scheme") {
        const dark = document.body.getAttribute("data-md-color-scheme") === "slate";
        if (typeof mermaid !== "undefined") {
          mermaid.initialize({ theme: dark ? "dark" : "default", startOnLoad: false });
          setTimeout(unclampMermaidSVGs, 600);
        }
      }
    });
  });
  observer.observe(document.body, { attributes: true });
});
