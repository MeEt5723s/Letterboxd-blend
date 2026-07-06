function addBlendButton() {
    const navList = document.querySelector(
        ".profile-navigation .navlist"
    );

    if (!navList) return;

    if (document.getElementById("lb-blend-btn")) return;

    const li = document.createElement("li");
    li.className = "navitem lb-blend-navitem";

    const button = document.createElement("a");
    button.id = "lb-blend-btn";
    // NOTE: deliberately not using Letterboxd's own "navlink" class here —
    // it carries padding/height rules that stack with ours and were
    // exactly what made the button oversized and vertically off.
    button.href = "#";
    button.textContent = "🎬 Blend";

    li.appendChild(button);
    navList.appendChild(li);
}
addBlendButton();

function getProfileUsername() {
  const parts = window.location.pathname
    .split("/")
    .filter(Boolean);

  return parts[0];
}

const blendButton = document.getElementById("lb-blend-btn");

if (blendButton) {
  blendButton.addEventListener("click", (e) => {
    e.preventDefault();

    const currentUser = getCurrentUserUsername();
    const profileUser = getProfileUsername();

    chrome.runtime.sendMessage({
  action: "openBlend",
  currentUser,
  profileUser
});
  });
}
function getCurrentUserUsername() {
  const profileLink = [...document.querySelectorAll('a[href^="/"]')]
    .find(a => {
      const href = a.getAttribute("href");

      return href &&
             href !== "/" &&
             href.split("/").filter(Boolean).length === 1 &&
             a.textContent.trim() !== "";
    });

  if (!profileLink) return null;

  return profileLink
    .getAttribute("href")
    .split("/")
    .filter(Boolean)[0];
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getFilms") {
    const movies = [];
    const posters = document.querySelectorAll(".react-component[data-item-slug]");

    posters.forEach((poster) => {
      const slug = poster.dataset.itemSlug;
      const title = poster.dataset.itemName || slug;
      const img = poster.querySelector(".poster img");
      const posterUrl = img?.src || img?.getAttribute("srcset")?.split(" ")[0] || "";

      let id = null;
      try {
        const identifier = JSON.parse(poster.dataset.posteredIdentifier);
        id = identifier.uid.replace("film:", "");
      } catch {}

      movies.push({ id, slug, title, poster: posterUrl });
    });

    sendResponse({ movies });
  }
  return true;
});