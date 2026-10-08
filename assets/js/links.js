/* AF TOURNAMENTS — centralized official links (single source of truth) */
const AF_LINKS = {
  tiktok: "https://www.tiktok.com/@tournamentsxgiveaway?_r=1&_t=ZS-9AMhYwA4GdY",
  youtube: "https://youtube.com/@alfagaminglive?si=UFLR12_doirKIc3l",
  whatsapp: "https://chat.whatsapp.com/GM9tP4702TY8xyZme6KltE?s=cl&p=i&ilr=4&iam=2"
};
// Apply to any anchor with data-af-link="tiktok|youtube|whatsapp"
(function () {
  document.querySelectorAll("[data-af-link]").forEach((a) => {
    const key = a.getAttribute("data-af-link");
    if (AF_LINKS[key]) {
      a.href = AF_LINKS[key];
      a.target = "_blank";
      a.rel = "noopener";
    }
  });
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
