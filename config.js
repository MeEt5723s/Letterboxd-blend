// Single source of truth for the backend URL. Every scraper/api module
// used to hardcode its own copy of this same string - meaning switching
// between local (http://localhost:8000) and production
// (https://letterboxd-blend-backend-en2i.onrender.com) meant editing five
// separate files and inevitably missing one. Change it here only.
//
// NOTE ON PLACEMENT: this file assumes it sits at the project root,
// as a sibling to the scraper/, api/, cache/, and UI/ folders (based on
// blend.js's "../scraper/..." style imports). If your actual folder
// layout differs, adjust the relative "../config.js" import paths below
// to match wherever you place this file.
// export const API_BASE_URL = "https://letterboxd-blend-backend-en2i.onrender.com";

// To test against your local backend instead, comment the line above and
// uncomment this one (and make sure "http://localhost:8000/*" is listed
// under host_permissions in manifest.json, then reload the extension):
export const API_BASE_URL = "http://localhost:8000";