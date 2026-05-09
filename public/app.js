/* boringDocs frontend — renders OpenAI-generated notes JSON as handwritten paper */

// SVG icon helper: references a <symbol> from the sprite in index.html
const iconSvg = (name, cls = "icon") =>
  `<svg class="${cls}"><use href="#icon-${name}"/></svg>`;
const iconLabel = (name, label) =>
  `${iconSvg(name)}<span>${label}</span>`;
const iconLabelRev = (label, name) =>
  `<span>${label}</span>${iconSvg(name)}`;

const $ = (sel) => document.querySelector(sel);
const urlInput = $("#url");
const topicInput = $("#topic");
const topicPagesInput = $("#topicPages");
const youtubeInput = $("#youtubeUrl");
const modeTopicBtn = $("#modeTopic");
const modeYoutubeBtn = $("#modeYoutube");
const topicPane = $("#topicPane");
const youtubePane = $("#youtubePane");
const fileDrop = $("#fileDrop");
const fileInputEl = $("#fileInput");
const fileDropTitle = $("#fileDropTitle");
const fileDropHint = $("#fileDropHint");
let selectedFile = null;
let selectedFileKind = null; // currently always "pdf" — kept as an enum for forward-compat
const keyInput = $("#apiKey");
const DEFAULT_MODEL = "gpt-4o-mini";
const goBtn = $("#go");
const saveBtn = $("#saveBtn");
const dlPdfBtn = $("#downloadPdf");
const dlPngBtn = $("#downloadPng");
const printBtn = $("#printBtn");
const openLibraryBtn = $("#openLibraryBtn");
const libraryModal = $("#libraryModal");
const composerCardEl = $("#composerCard");
const composerModalEl = $("#composerModal");
const closeComposerBtn = $("#closeComposer");
const notesGridEl = $("#notesGrid");
const dashboardCountEl = $("#dashboardCount");
const dashboardEmptyEl = $("#dashboardEmpty");
const dashboardFiltersEl = $("#dashboardFilters");
const dashboardSearchEl = $("#dashboardSearch");
const closeLibraryBtn = $("#closeLibrary");
const libraryListEl = $("#libraryList");
const libraryFolderEl = $("#libraryFolder");
const librarySearchEl = $("#librarySearch");
const libraryCountEl = $("#libraryCount");
const controlsCard = $("#controlsCard");
const jumpBtn = $("#jumpBtn");
const jumpMenuEl = $("#jumpMenu");
const jumpWrapEl = $("#jumpWrap");
const shortcutsBtn = $("#shortcutsBtn");
const shortcutsModal = $("#shortcutsModal");
const closeShortcutsBtn = $("#closeShortcuts");
const backHomeBtn = $("#backHomeBtn");
const openFontBtn = $("#openFontBtn");
const fontModal = $("#fontModal");
const closeFontBtn = $("#closeFont");
const fontDrop = $("#fontDrop");
const fontFileInput = $("#fontFile");
const fontCurrentEl = $("#fontCurrent");
const fontCurrentNameEl = $("#fontCurrentName");
const fontResetBtn = $("#fontReset");
const fontTabPresetEl = $("#fontTabPreset");
const fontPanePresetEl = $("#fontPanePreset");
const presetGridEl = $("#presetGrid");
const statusEl = $("#status");
const readerBar = $("#reader-bar");
const viewScrollBtn = $("#viewScroll");
const viewBookBtn = $("#viewBook");
const bookNav = $("#bookNav");
const prevBtn = $("#prevPage");
const nextBtn = $("#nextPage");
const pageIndicator = $("#pageIndicator");
const fsBtn = $("#fullscreenBtn");
const readerContainer = $("#reader-container");
const fsFab = $("#fsFab");
const fsFabPage = $("#fsFabPage");
const papersEl = $("#papers");
const paperWrap = $("#paper-wrap");
const crawlChk = $("#crawl");
const maxPagesWrap = $("#maxPagesWrap");
const maxPagesInput = $("#maxPages");
const progressEl = $("#progress");
const progressFill = $("#progressFill");
const progressText = $("#progressText");
const pickerModal = $("#pickerModal");
const pickerListEl = $("#pickerList");
const pickerSubEl = $("#pickerSub");
const pickerCountEl = $("#pickerCount");
const pickerConfirmBtn = $("#pickerConfirm");
const pickerCancelBtn = $("#pickerCancel");
const pickerCloseBtn = $("#closePicker");
const pickerSelectAllBtn = $("#pickerSelectAll");
const pickerSelectNoneBtn = $("#pickerSelectNone");
const pickerFolderBtn = $("#pickerFolderBtn");
const pickerFolderLabel = $("#pickerFolderLabel");

// remember key locally so users don't re-enter it every reload
const KEY_STORAGE = "boringdocs.openai.key";
const CRAWL_STORAGE = "boringdocs.crawl";
const MAX_STORAGE = "boringdocs.maxPages";
const MODE_STORAGE = "boringdocs.mode";
const TOPIC_PAGES_STORAGE = "boringdocs.topicPages";
keyInput.value = localStorage.getItem(KEY_STORAGE) || "";
crawlChk.checked = localStorage.getItem(CRAWL_STORAGE) === "1";
maxPagesInput.value = localStorage.getItem(MAX_STORAGE) || "30";
topicPagesInput.value = localStorage.getItem(TOPIC_PAGES_STORAGE) || "5";

const STORED_MODE = localStorage.getItem(MODE_STORAGE);
const _validModes = new Set(["topic", "youtube"]);
// "topic" is the default and now hosts URL/file/topic-search as separate
// input methods inside one pane. Legacy "url"/"pdf"/"audio"/"file" stored
// values all migrate to "topic".
let inputMode = _validModes.has(STORED_MODE) ? STORED_MODE : "topic";
applyInputMode();
toggleCrawlUi();

modeTopicBtn.addEventListener("click", () => setInputMode("topic"));
modeYoutubeBtn.addEventListener("click", () => setInputMode("youtube"));

const PDF_MAX_BYTES = 30 * 1024 * 1024; // 30 MB — text extraction stays responsive below this
const FILE_DROP_DEFAULT_TITLE = "Click to upload, or drop a PDF here";
const FILE_DROP_DEFAULT_HINT = "Up to 30 MB. Text-only PDFs work best.";

function detectFileKind(file) {
  if (!file) return null;
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  return null;
}

function handleFileSelected(file) {
  if (!file) return;
  const kind = detectFileKind(file);
  if (!kind) {
    setStatus("unsupported file — choose a PDF.");
    return;
  }
  if (file.size > PDF_MAX_BYTES) {
    setStatus(`PDF too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — keep it under 30 MB.`);
    return;
  }
  selectedFile = file;
  selectedFileKind = kind;
  if (fileDrop) fileDrop.classList.add("has-file");
  if (fileDropTitle) fileDropTitle.textContent = file.name;
  if (fileDropHint) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    fileDropHint.textContent = `${kind.toUpperCase()} · ${sizeMb} MB — click to choose a different file`;
  }
  if (inputMode === "topic") goBtn.innerHTML = topicGoButtonLabel();
  setStatus(`ready: ${file.name}`);
}

fileInputEl?.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) handleFileSelected(f);
  e.target.value = "";
});

if (fileDrop) {
  ["dragenter", "dragover"].forEach((evt) =>
    fileDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      fileDrop.classList.add("dragging");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    fileDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      fileDrop.classList.remove("dragging");
    })
  );
  fileDrop.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFileSelected(f);
  });
}
topicPagesInput.addEventListener("change", () => {
  localStorage.setItem(TOPIC_PAGES_STORAGE, topicPagesInput.value);
  syncPagePills();
});
topicPagesInput.addEventListener("input", syncPagePills);

// page pill selector → number input
document.getElementById("pagePills")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".page-pill[data-pages]");
  if (!btn) return;
  const n = Number(btn.dataset.pages);
  if (!Number.isFinite(n)) return;
  topicPagesInput.value = String(n);
  localStorage.setItem(TOPIC_PAGES_STORAGE, String(n));
  syncPagePills();
});

function syncPagePills() {
  const v = String(Number(topicPagesInput.value) || 5);
  document.querySelectorAll("#pagePills .page-pill[data-pages]").forEach((b) => {
    b.classList.toggle("active", b.dataset.pages === v);
  });
}
syncPagePills();

const VALID_INPUT_MODES = new Set(["topic", "youtube"]);

function setInputMode(m) {
  inputMode = VALID_INPUT_MODES.has(m) ? m : "topic";
  localStorage.setItem(MODE_STORAGE, inputMode);
  applyInputMode();
}

function topicGoButtonLabel() {
  // The topic pane carries three input methods: URL, topic search, and
  // file upload. Button label follows whichever is queued — explicit input
  // (URL or file) wins over the more general topic-search field.
  const url = urlInput?.value?.trim();
  if (url) {
    return crawlChk.checked
      ? iconLabel("globe", "Start crawling")
      : iconLabel("pencil", "Convert page");
  }
  if (selectedFileKind === "pdf") return iconLabel("book-open", "Convert PDF");
  return iconLabel("search", "Find docs & convert");
}

function applyInputMode() {
  const isTopic = inputMode === "topic";
  const isYoutube = inputMode === "youtube";
  modeTopicBtn.classList.toggle("active", isTopic);
  modeYoutubeBtn.classList.toggle("active", isYoutube);
  topicPane.style.display = isTopic ? "" : "none";
  youtubePane.style.display = isYoutube ? "" : "none";
  if (isYoutube) {
    goBtn.innerHTML = iconLabel("play", "Convert video");
  } else {
    goBtn.innerHTML = topicGoButtonLabel();
  }
}

keyInput.addEventListener("change", () =>
  localStorage.setItem(KEY_STORAGE, keyInput.value.trim())
);
crawlChk.addEventListener("change", () => {
  localStorage.setItem(CRAWL_STORAGE, crawlChk.checked ? "1" : "0");
  toggleCrawlUi();
});
maxPagesInput.addEventListener("change", () =>
  localStorage.setItem(MAX_STORAGE, maxPagesInput.value)
);

function toggleCrawlUi() {
  maxPagesWrap.style.display = crawlChk.checked ? "" : "none";
  if (inputMode === "topic") goBtn.innerHTML = topicGoButtonLabel();
}

// Refresh the topic-pane button label as the user types into the URL field
// — switching between "Find docs & convert" / "Convert page" / "Start
// crawling" so the user can predict what will run.
urlInput?.addEventListener("input", () => {
  if (inputMode === "topic") goBtn.innerHTML = topicGoButtonLabel();
});

/* ---------------- user-uploaded handwriting font ----------------
   Lets the user upload a TTF/OTF/WOFF/WOFF2 of their actual handwriting.
   The font is registered as "UserHand" via the FontFace API and persisted
   as a base64 data URL in localStorage so it survives reloads. CSS rules
   in styles.css override the built-in handwriting fonts when body.user-font
   is set, so EVERY rendered note (including PDF/PNG exports) uses it. */

const USER_FONT_STORAGE = "boringdocs.userFont"; // { name, dataUrl }
const USER_FONT_FAMILY = "UserHand";
const USER_FONT_MAX_BYTES = 4 * 1024 * 1024; // 4 MB — comfortable for localStorage
let userFontFace = null;

async function applyUserFont(dataUrl, displayName) {
  // Drop any previously-registered face so the new bytes win.
  if (userFontFace && document.fonts) {
    try { document.fonts.delete(userFontFace); } catch {}
  }
  const face = new FontFace(USER_FONT_FAMILY, `url(${dataUrl})`);
  await face.load();
  document.fonts.add(face);
  userFontFace = face;
  document.body.classList.add("user-font");
  // A custom font wants the full UserHand-first stack, not whatever a
  // previously-picked preset put in the variable.
  document.documentElement.style.removeProperty("--user-font-stack");
  if (fontCurrentEl) fontCurrentEl.style.display = "";
  if (fontCurrentNameEl) fontCurrentNameEl.textContent = displayName || "Custom font";
  syncPresetCardActive(null);
  // Force a relayout so existing notes pick up the new font immediately.
  if (papersEl) papersEl.style.willChange = "contents";
  requestAnimationFrame(() => {
    if (papersEl) papersEl.style.willChange = "";
  });
}

function applyPresetFont(family, displayName) {
  // Drop any FontFace from a prior custom upload — presets render via the
  // browser's already-loaded Google Font, no FontFace needed.
  if (userFontFace && document.fonts) {
    try { document.fonts.delete(userFontFace); } catch {}
    userFontFace = null;
  }
  document.documentElement.style.setProperty(
    "--user-font-stack",
    `"${family}", cursive`
  );
  document.body.classList.add("user-font");
  if (fontCurrentEl) fontCurrentEl.style.display = "";
  if (fontCurrentNameEl) fontCurrentNameEl.textContent = displayName || family;
  try {
    localStorage.setItem(
      USER_FONT_STORAGE,
      JSON.stringify({ kind: "preset", family, name: displayName || family })
    );
  } catch (e) {
    console.warn("couldn't persist preset font:", e);
  }
  syncPresetCardActive(family);
  if (papersEl) papersEl.style.willChange = "contents";
  requestAnimationFrame(() => {
    if (papersEl) papersEl.style.willChange = "";
  });
}

function syncPresetCardActive(family) {
  if (!presetGridEl) return;
  presetGridEl.querySelectorAll(".preset-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.preset === family);
  });
}

function clearUserFont() {
  if (userFontFace && document.fonts) {
    try { document.fonts.delete(userFontFace); } catch {}
    userFontFace = null;
  }
  document.body.classList.remove("user-font");
  document.documentElement.style.removeProperty("--user-font-stack");
  localStorage.removeItem(USER_FONT_STORAGE);
  if (fontCurrentEl) fontCurrentEl.style.display = "none";
  if (fontCurrentNameEl) fontCurrentNameEl.textContent = "—";
  syncPresetCardActive(null);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}

async function handleFontFile(file) {
  if (!file) return;
  const okExt = /\.(ttf|otf|woff2?|sfnt)$/i.test(file.name);
  if (!okExt) {
    setStatus("font must be .ttf, .otf, .woff, or .woff2");
    return;
  }
  if (file.size > USER_FONT_MAX_BYTES) {
    setStatus(
      `font too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — max 4 MB`
    );
    return;
  }
  setStatus("loading your font…");
  try {
    const dataUrl = await readFileAsDataUrl(file);
    await applyUserFont(dataUrl, file.name.replace(/\.[^.]+$/, ""));
    try {
      localStorage.setItem(
        USER_FONT_STORAGE,
        JSON.stringify({ name: file.name, dataUrl })
      );
    } catch (e) {
      // localStorage quota — font still works for this session.
      console.warn("couldn't persist font:", e);
      setStatus(`using ${file.name} (couldn't save: storage full)`);
      return;
    }
    setStatus(`using ${file.name} ✓`);
  } catch (err) {
    console.error(err);
    setStatus(`couldn't load font: ${err?.message || err}`);
  }
}

async function restoreSavedFont() {
  const raw = localStorage.getItem(USER_FONT_STORAGE);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved?.kind === "preset" && saved.family) {
      applyPresetFont(saved.family, saved.name || saved.family);
      return;
    }
    if (saved?.dataUrl) {
      await applyUserFont(
        saved.dataUrl,
        saved.name?.replace(/\.[^.]+$/, "") || "Custom font"
      );
    }
  } catch (e) {
    console.warn("failed to restore saved font:", e);
    localStorage.removeItem(USER_FONT_STORAGE);
  }
}

// Wire up the modal once.
openFontBtn?.addEventListener("click", () => {
  if (!fontModal) return;
  fontModal.style.display = "flex";
});
closeFontBtn?.addEventListener("click", () => {
  if (fontModal) fontModal.style.display = "none";
});
fontModal?.addEventListener("click", (e) => {
  if (e.target === fontModal) fontModal.style.display = "none";
});
fontFileInput?.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) handleFontFile(f);
  // reset so re-uploading the same file fires "change" again
  e.target.value = "";
});
fontResetBtn?.addEventListener("click", () => {
  clearUserFont();
  setStatus("font reset to default");
});

presetGridEl?.addEventListener("click", (e) => {
  const card = e.target.closest(".preset-card");
  if (!card) return;
  const family = card.dataset.preset;
  if (!family) return;
  applyPresetFont(family, family);
  setStatus(`using ${family} ✓`);
});

// Drag-and-drop a font file onto the upload card.
if (fontDrop) {
  ["dragenter", "dragover"].forEach((evt) =>
    fontDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      fontDrop.classList.add("dragging");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    fontDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      fontDrop.classList.remove("dragging");
    })
  );
  fontDrop.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFontFile(f);
  });
}

restoreSavedFont();

/* ---------------- handwriting → TTF builder ----------------
   The user prints a labeled grid of 80 cells, fills each with the matching
   character, photographs the page, and uploads it. We:
     1. show the photo on a canvas and let the user drag four corner markers
        onto the grid corners (manual perspective alignment — far more reliable
        than auto-detection across all phone cameras / lighting conditions),
     2. compute a 3×3 homography from the corner pairs and warp the photo to
        a fixed 1600×2000 axis-aligned canvas,
     3. slice that canvas into 80 cells, binarize each one, vectorize the ink
        with ImageTracer, and assemble the resulting paths into a real TTF
        font with opentype.js,
     4. register the TTF as "UserHand" via the existing user-font pipeline.
   Result: one button → working font built from a phone photo. */

const BUILDER_CHARS = [
  ['A','B','C','D','E','F','G','H'],
  ['I','J','K','L','M','N','O','P'],
  ['Q','R','S','T','U','V','W','X'],
  ['Y','Z','a','b','c','d','e','f'],
  ['g','h','i','j','k','l','m','n'],
  ['o','p','q','r','s','t','u','v'],
  ['w','x','y','z','0','1','2','3'],
  ['4','5','6','7','8','9','.',','],
  ['!','?',"'",'"',':',';','-','_'],
  ['(',')','&','+','=','/','*','@'],
];
const BUILDER_COLS = 8;
const BUILDER_ROWS = 10;
const WARP_W = 1600;
const WARP_H = 2000;
const CELL_W = WARP_W / BUILDER_COLS; // 200
const CELL_H = WARP_H / BUILDER_ROWS; // 200
// Letters with descenders — we place these so their bottom drops below
// baseline. Everything else sits on baseline.
const DESCENDER_CHARS = new Set(["g", "j", "p", "q", "y"]);

const builderEls = {
  paneUpload: $("#fontPaneUpload"),
  paneBuild: $("#fontPaneBuild"),
  paneSample: $("#fontPaneSample"),
  tabUpload: $("#fontTabUpload"),
  tabBuild: $("#fontTabBuild"),
  tabSample: $("#fontTabSample"),
  print: $("#builderPrint"),
  file: $("#builderFile"),
  uploadCard: $("#builderUploadCard"),
  uploadTitle: $("#builderUploadTitle"),
  step3: $("#builderStep3"),
  canvas: $("#builderCanvas"),
  cornerHandles: $("#builderCornerHandles"),
  build: $("#builderBuild"),
  progress: $("#builderProgress"),
  progressFill: $("#builderProgressFill"),
  progressText: $("#builderProgressText"),
};

let builderImage = null; // HTMLImageElement currently loaded
let builderCorners = []; // 4 [x, y] points in IMAGE pixel coordinates

/* tab switching — preset picker (default) and writing-sample tab */
[fontTabPresetEl, builderEls.tabSample].forEach((btn) => {
  btn?.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    fontTabPresetEl?.classList.toggle("active", tab === "preset");
    builderEls.tabSample?.classList.toggle("active", tab === "sample");
    if (fontPanePresetEl)
      fontPanePresetEl.style.display = tab === "preset" ? "" : "none";
    if (builderEls.paneSample)
      builderEls.paneSample.style.display = tab === "sample" ? "" : "none";
  });
});

/* step 1: open printable template in a new window */
builderEls.print?.addEventListener("click", openPrintableTemplate);

function openPrintableTemplate() {
  const cells = BUILDER_CHARS.flatMap((row, r) =>
    row.map((ch, c) => {
      // mark the four corner cells with a fiducial triangle so the user can
      // see exactly where to put the colored corner handles in step 3.
      const isCorner =
        (r === 0 && c === 0) ||
        (r === 0 && c === BUILDER_COLS - 1) ||
        (r === BUILDER_ROWS - 1 && c === BUILDER_COLS - 1) ||
        (r === BUILDER_ROWS - 1 && c === 0);
      const safe = ch
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      return `<div class="cell${isCorner ? " corner" : ""}"><span class="lbl">${safe}</span></div>`;
    })
  ).join("");

  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><title>boringDocs handwriting template</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; padding: 0; margin: 0; }
    h1 { margin: 0 0 4mm; font-size: 14pt; font-weight: 700; }
    p { margin: 0 0 6mm; font-size: 10pt; color: #444; line-height: 1.5; }
    .grid {
      display: grid;
      grid-template-columns: repeat(${BUILDER_COLS}, 1fr);
      grid-template-rows: repeat(${BUILDER_ROWS}, 1fr);
      border: 2.5px solid #000;
      width: 190mm;
      aspect-ratio: ${BUILDER_COLS} / ${BUILDER_ROWS};
    }
    .cell {
      border: 1px solid #999;
      position: relative;
      min-height: 0;
    }
    .cell.corner::before {
      content: "";
      position: absolute;
      width: 6mm;
      height: 6mm;
      background: #000;
      top: 1mm; left: 1mm;
    }
    .cell .lbl {
      position: absolute;
      bottom: 1mm;
      right: 2mm;
      font-size: 8pt;
      color: #aaa;
      font-weight: 600;
    }
    .print-btn {
      position: fixed;
      top: 12px;
      right: 12px;
      padding: 8px 14px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
    }
    @media print { .print-btn, .header { display: none; } body { padding: 0; } }
    .header { padding: 12mm 12mm 0; }
    .body { padding: 0 12mm; }
  </style></head><body>
  <button class="print-btn" onclick="window.print()">Print</button>
  <div class="header">
    <h1>boringDocs — handwriting template</h1>
    <p>Fill each box with the small letter shown in its corner, using a <strong>thick black pen</strong>. Keep each character inside its box. The four corner boxes have black squares — leave them be (they help us align your photo).</p>
  </div>
  <div class="body"><div class="grid">${cells}</div></div>
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) {
    showAlert({
      title: "Popup blocked",
      message: "Couldn't open the template in a new tab. Allow popups for this site and try again.",
    });
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/* step 2: handle the uploaded photo */
builderEls.file?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  if (!f.type.startsWith("image/")) {
    await showAlert({ title: "Wrong file type", message: "Please upload an image (JPG, PNG, or WebP)." });
    return;
  }
  if (f.size > 8 * 1024 * 1024) {
    await showAlert({ title: "Image too large", message: "Please use an image under 8 MB." });
    return;
  }
  if (builderEls.uploadTitle) builderEls.uploadTitle.textContent = f.name;
  const img = await loadImageFromFile(f);
  builderImage = img;
  setupBuilderCanvas(img);
  if (builderEls.step3) builderEls.step3.style.display = "";
  builderEls.step3?.scrollIntoView({ behavior: "smooth", block: "start" });
});

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setupBuilderCanvas(img) {
  const canvas = builderEls.canvas;
  if (!canvas) return;
  // fit to a max display width so the modal stays sane on small screens
  const maxW = 720;
  const scale = Math.min(1, maxW / img.naturalWidth);
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // initial corner positions: 10% inset from the photo edges (in IMAGE coords)
  const inset = 0.1;
  const W = img.naturalWidth, H = img.naturalHeight;
  builderCorners = [
    [inset * W, inset * H],         // top-left
    [(1 - inset) * W, inset * H],   // top-right
    [(1 - inset) * W, (1 - inset) * H], // bottom-right
    [inset * W, (1 - inset) * H],   // bottom-left
  ];
  renderCornerHandles();
}

function renderCornerHandles() {
  const wrap = builderEls.cornerHandles;
  const canvas = builderEls.canvas;
  if (!wrap || !canvas || !builderImage) return;
  const sx = canvas.width / builderImage.naturalWidth;
  const sy = canvas.height / builderImage.naturalHeight;
  const labels = ["TL", "TR", "BR", "BL"];
  wrap.innerHTML = builderCorners
    .map(([x, y], i) => {
      const dx = x * sx;
      const dy = y * sy;
      return `<div class="corner-handle" data-corner="${i}" style="left:${dx}px;top:${dy}px">${labels[i]}</div>`;
    })
    .join("");
  wrap.querySelectorAll(".corner-handle").forEach((el) => {
    attachCornerDrag(el);
  });
}

function attachCornerDrag(handle) {
  const idx = Number(handle.dataset.corner);
  const canvas = builderEls.canvas;
  const start = (e) => {
    e.preventDefault();
    const move = (ev) => {
      const point = ev.touches ? ev.touches[0] : ev;
      const rect = canvas.getBoundingClientRect();
      const dx = Math.max(0, Math.min(rect.width, point.clientX - rect.left));
      const dy = Math.max(0, Math.min(rect.height, point.clientY - rect.top));
      const sx = builderImage.naturalWidth / canvas.width;
      const sy = builderImage.naturalHeight / canvas.height;
      builderCorners[idx] = [dx * sx, dy * sy];
      handle.style.left = dx + "px";
      handle.style.top = dy + "px";
    };
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  };
  handle.addEventListener("mousedown", start);
  handle.addEventListener("touchstart", start, { passive: false });
}

/* step 3: build the font */
builderEls.build?.addEventListener("click", async () => {
  if (!builderImage) return;
  if (typeof opentype === "undefined" || typeof ImageTracer === "undefined") {
    await showAlert({
      title: "Libraries missing",
      message: "The font-building libraries didn't load. Check your network connection and refresh the page.",
    });
    return;
  }
  builderEls.build.disabled = true;
  showBuilderProgress(0, "warping image…");
  try {
    const warped = warpImageToGrid(builderImage, builderCorners, WARP_W, WARP_H);
    showBuilderProgress(15, "extracting cells…");
    await microtask();
    const glyphs = await extractAndVectorizeGlyphs(warped, (pct, msg) => {
      // 15% → 85%
      showBuilderProgress(15 + pct * 0.7, msg);
    });
    showBuilderProgress(88, "assembling TTF…");
    await microtask();
    const ttfBuffer = assembleFont(glyphs);
    showBuilderProgress(95, "registering font…");
    await microtask();
    const dataUrl = arrayBufferToDataUrl(ttfBuffer, "font/ttf");
    await applyUserFont(dataUrl, "Your handwriting");
    try {
      localStorage.setItem(
        USER_FONT_STORAGE,
        JSON.stringify({ name: "Your handwriting.ttf", dataUrl })
      );
    } catch (e) {
      console.warn("couldn't persist generated font:", e);
    }
    showBuilderProgress(100, "done — your font is live ✓");
    setTimeout(() => {
      if (fontModal) fontModal.style.display = "none";
      hideBuilderProgress();
    }, 900);
  } catch (err) {
    console.error(err);
    showBuilderProgress(0, `failed: ${err?.message || err}`);
  } finally {
    builderEls.build.disabled = false;
  }
});

function showBuilderProgress(pct, text) {
  if (!builderEls.progress) return;
  builderEls.progress.style.display = "";
  if (builderEls.progressFill)
    builderEls.progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (builderEls.progressText) builderEls.progressText.textContent = text || "";
}
function hideBuilderProgress() {
  if (builderEls.progress) builderEls.progress.style.display = "none";
}
const microtask = () => new Promise((r) => setTimeout(r, 0));

/* ---- math: solve an 8×8 linear system via Gaussian elimination.
   Input: 8 equations (a) and 8 RHS values (b). Returns the 8 unknowns. ---- */
function solve8x8(a, b) {
  const n = 8;
  // augment
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    // partial pivot
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    }
    if (p !== c) [m[c], m[p]] = [m[p], m[c]];
    if (Math.abs(m[c][c]) < 1e-12) throw new Error("Singular matrix");
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let j = i + 1; j < n; j++) s -= m[i][j] * x[j];
    x[i] = s / m[i][i];
  }
  return x;
}

// Compute 3×3 homography mapping src→dst (each is 4 [x,y] points).
function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dx, dy);
  }
  const h = solve8x8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// Project a 2D point through a 3×3 homography (row-major, 9 values).
function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/* Backward-map every pixel of a `WARP_W × WARP_H` canvas back to the source
   photo so the four user-picked corners line up with the rectangle (0,0)…
   (WARP_W,WARP_H). Bilinear-sampled to keep ink crisp. */
function warpImageToGrid(img, corners, outW, outH) {
  const dstQuad = [[0, 0], [outW, 0], [outW, outH], [0, outH]];
  // We need dst→src for backward mapping.
  const h = homography(dstQuad, corners);

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = img.naturalWidth;
  srcCanvas.height = img.naturalHeight;
  srcCanvas.getContext("2d").drawImage(img, 0, 0);
  const srcImg = srcCanvas
    .getContext("2d")
    .getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const sd = srcImg.data;
  const sw = srcImg.width, sh = srcImg.height;

  const out = document.createElement("canvas");
  out.width = outW; out.height = outH;
  const outCtx = out.getContext("2d");
  const outImg = outCtx.createImageData(outW, outH);
  const od = outImg.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = applyH(h, x, y);
      const oidx = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        od[oidx] = 255; od[oidx + 1] = 255; od[oidx + 2] = 255; od[oidx + 3] = 255;
        continue;
      }
      // bilinear
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + (x0 + 1)) * 4;
      const i01 = ((y0 + 1) * sw + x0) * 4;
      const i11 = ((y0 + 1) * sw + (x0 + 1)) * 4;
      for (let k = 0; k < 3; k++) {
        const v =
          sd[i00 + k] * (1 - fx) * (1 - fy) +
          sd[i10 + k] * fx * (1 - fy) +
          sd[i01 + k] * (1 - fx) * fy +
          sd[i11 + k] * fx * fy;
        od[oidx + k] = v;
      }
      od[oidx + 3] = 255;
    }
  }
  outCtx.putImageData(outImg, 0, 0);
  return out;
}

/* For each cell in the warped grid: crop the inner area (avoiding the
   printed label and the cell border), binarize, find the ink bounding box,
   trace it to vector paths. Returns array of { char, paths, bbox }. */
async function extractAndVectorizeGlyphs(warpedCanvas, onProgress) {
  const ctx = warpedCanvas.getContext("2d");
  const fullImg = ctx.getImageData(0, 0, WARP_W, WARP_H);
  const out = [];
  const total = BUILDER_ROWS * BUILDER_COLS;
  for (let r = 0; r < BUILDER_ROWS; r++) {
    for (let c = 0; c < BUILDER_COLS; c++) {
      const idx = r * BUILDER_COLS + c;
      const ch = BUILDER_CHARS[r][c];
      // crop the cell with a small inner margin (avoids grid lines + label)
      const cellX = Math.round(c * CELL_W + CELL_W * 0.08);
      const cellY = Math.round(r * CELL_H + CELL_H * 0.08);
      const cellW = Math.round(CELL_W * 0.84);
      const cellH = Math.round(CELL_H * 0.78); // bottom 18% trimmed (label area)
      const bin = binarizeRegion(fullImg, cellX, cellY, cellW, cellH);
      const trimmed = trimToInk(bin);
      if (trimmed) {
        const traced = traceGlyph(trimmed);
        if (traced) out.push({ char: ch, ...traced });
      }
      onProgress?.(((idx + 1) / total) * 100, `tracing ${ch} (${idx + 1}/${total})`);
      if (idx % 8 === 0) await microtask();
    }
  }
  return out;
}

/* Binarize a sub-rectangle into a {w,h,data:Uint8Array} where 1=ink, 0=paper.
   Uses a simple luminance threshold — works well on cleanly-photographed
   black-pen-on-white-paper. */
function binarizeRegion(srcImg, x, y, w, h) {
  const out = new Uint8Array(w * h);
  const sd = srcImg.data;
  const sw = srcImg.width;
  // adaptive-ish: pick threshold from the cell's own histogram
  // (just take the mean luminance, anything below mean - 20 = ink)
  let sum = 0, count = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sIdx = ((y + j) * sw + (x + i)) * 4;
      const lum = 0.299 * sd[sIdx] + 0.587 * sd[sIdx + 1] + 0.114 * sd[sIdx + 2];
      sum += lum; count++;
    }
  }
  const mean = sum / count;
  const thresh = Math.min(170, Math.max(80, mean - 25));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sIdx = ((y + j) * sw + (x + i)) * 4;
      const lum = 0.299 * sd[sIdx] + 0.587 * sd[sIdx + 1] + 0.114 * sd[sIdx + 2];
      out[j * w + i] = lum < thresh ? 1 : 0;
    }
  }
  return { w, h, data: out };
}

// Crop to ink bbox; returns null if there's nothing dark.
function trimToInk(bin) {
  let minX = bin.w, minY = bin.h, maxX = -1, maxY = -1;
  for (let y = 0; y < bin.h; y++) {
    for (let x = 0; x < bin.w; x++) {
      if (bin.data[y * bin.w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // no ink
  // ignore tiny specks (< 6 pixels in either dimension = likely dust)
  if (maxX - minX < 6 || maxY - minY < 6) return null;
  // pad a couple pixels so vectorization has clean edges
  const pad = 2;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(bin.w - 1, maxX + pad);
  const y1 = Math.min(bin.h - 1, maxY + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      out[j * w + i] = bin.data[(y0 + j) * bin.w + (x0 + i)];
    }
  }
  return { w, h, data: out };
}

/* Vectorize a binary glyph bitmap to a list of SVG path strings via
   ImageTracer. We hand it a 2-color ImageData (black ink on white) and pick
   only the dark-fill paths. */
function traceGlyph(bin) {
  const canvas = document.createElement("canvas");
  canvas.width = bin.w; canvas.height = bin.h;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(bin.w, bin.h);
  for (let i = 0; i < bin.data.length; i++) {
    const v = bin.data[i] ? 0 : 255;
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  const opts = {
    numberofcolors: 2,
    colorquantcycles: 1,
    blurradius: 0,
    ltres: 0.5,
    qtres: 0.5,
    pathomit: 4,
    rightangleenhance: false,
    strokewidth: 0,
    linefilter: false,
    pal: [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ],
  };
  const svg = ImageTracer.imagedataToSVG(imgData, opts);
  const dark = extractDarkPathsFromSVG(svg);
  if (!dark.length) return null;
  return { paths: dark, bbox: { w: bin.w, h: bin.h } };
}

// Pull the `d` attributes of every path whose fill is the dark color.
function extractDarkPathsFromSVG(svg) {
  const paths = [];
  const re = /<path[^>]*fill="([^"]+)"[^>]*d="([^"]+)"/g;
  let m;
  while ((m = re.exec(svg))) {
    const fill = m[1].toLowerCase();
    // dark-ish? RGB sum < 384 (i.e. avg <128)
    const nums = fill.match(/\d+/g);
    if (nums && nums.length >= 3) {
      const sum = Number(nums[0]) + Number(nums[1]) + Number(nums[2]);
      if (sum < 384) paths.push(m[2]);
    }
  }
  return paths;
}

/* ----- font assembly ----- */
const UNITS_PER_EM = 1000;
const ASCENDER = 800;
const DESCENDER = -200;
const GLYPH_HEIGHT = ASCENDER; // 800 units → glyph height

/* Convert ImageTracer's path data ("M x y L x y Q x1 y1 x y Z …") to
   opentype.js path commands. We support M, L, H, V, Q, C, Z (absolute and
   relative) — that's everything ImageTracer emits. The outline must be
   y-flipped (image y goes down, font y goes up) and translated to baseline. */
function svgPathToOpentype(d, transform) {
  const path = new opentype.Path();
  const cmds = parseSVGPathCommands(d);
  let cx = 0, cy = 0; // current point (in source pixel space)
  for (const cmd of cmds) {
    const t = cmd.type;
    const a = cmd.args;
    const rel = t === t.toLowerCase() && t !== "z" && t !== "Z";
    const T = t.toUpperCase();
    const tx = (px) => transform.x(rel ? cx + px : px);
    const ty = (py) => transform.y(rel ? cy + py : py);
    if (T === "M") {
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      path.moveTo(transform.x(x), transform.y(y));
      cx = x; cy = y;
    } else if (T === "L") {
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      path.lineTo(transform.x(x), transform.y(y));
      cx = x; cy = y;
    } else if (T === "H") {
      const x = rel ? cx + a[0] : a[0];
      path.lineTo(transform.x(x), transform.y(cy));
      cx = x;
    } else if (T === "V") {
      const y = rel ? cy + a[0] : a[0];
      path.lineTo(transform.x(cx), transform.y(y));
      cy = y;
    } else if (T === "Q") {
      const x1 = rel ? cx + a[0] : a[0];
      const y1 = rel ? cy + a[1] : a[1];
      const x = rel ? cx + a[2] : a[2];
      const y = rel ? cy + a[3] : a[3];
      path.quadraticCurveTo(transform.x(x1), transform.y(y1), transform.x(x), transform.y(y));
      cx = x; cy = y;
    } else if (T === "C") {
      const x1 = rel ? cx + a[0] : a[0];
      const y1 = rel ? cy + a[1] : a[1];
      const x2 = rel ? cx + a[2] : a[2];
      const y2 = rel ? cy + a[3] : a[3];
      const x = rel ? cx + a[4] : a[4];
      const y = rel ? cy + a[5] : a[5];
      path.curveTo(transform.x(x1), transform.y(y1), transform.x(x2), transform.y(y2), transform.x(x), transform.y(y));
      cx = x; cy = y;
    } else if (T === "Z") {
      path.close();
    }
  }
  return path;
}

// Tokenize an SVG `d` attribute into a list of { type, args }.
function parseSVGPathCommands(d) {
  const out = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  const argCounts = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  let m;
  while ((m = re.exec(d))) {
    const type = m[1];
    const argStr = m[2].trim();
    const nums = argStr ? argStr.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n)) : [];
    const n = argCounts[type.toUpperCase()];
    if (n === 0) {
      out.push({ type, args: [] });
      continue;
    }
    // Multiple coordinate sets after one command letter = repeated commands
    for (let i = 0; i < nums.length; i += n) {
      out.push({ type, args: nums.slice(i, i + n) });
    }
  }
  return out;
}

/* Split a flat command stream into separate subpaths (each starting at M).
   Vectorizers emit "outer + inner ring" as two subpaths inside one `d`,
   and we need to treat them independently to fix winding direction. */
function splitCommandsIntoSubpaths(commands) {
  const subs = [];
  let cur = [];
  for (const c of commands) {
    if (c.type.toUpperCase() === "M" && cur.length > 0) {
      subs.push(cur);
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length) subs.push(cur);
  return subs;
}

/* Sample each command into a list of (x,y) points in *source* pixel space.
   Used for area + bbox tests; not for the final glyph rendering. Curves are
   sampled coarsely (4 segments) since we just need a polyline approximation. */
function commandsToPolyline(commands) {
  const pts = [];
  let cx = 0, cy = 0;
  let startX = 0, startY = 0;
  for (const c of commands) {
    const T = c.type.toUpperCase();
    const rel = c.type !== T;
    const a = c.args;
    if (T === "M") {
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      pts.push([x, y]);
      cx = x; cy = y; startX = x; startY = y;
    } else if (T === "L") {
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      pts.push([x, y]); cx = x; cy = y;
    } else if (T === "H") {
      const x = rel ? cx + a[0] : a[0];
      pts.push([x, cy]); cx = x;
    } else if (T === "V") {
      const y = rel ? cy + a[0] : a[0];
      pts.push([cx, y]); cy = y;
    } else if (T === "Q") {
      const x1 = rel ? cx + a[0] : a[0];
      const y1 = rel ? cy + a[1] : a[1];
      const x = rel ? cx + a[2] : a[2];
      const y = rel ? cy + a[3] : a[3];
      for (let i = 1; i <= 4; i++) {
        const t = i / 4, it = 1 - t;
        pts.push([
          it * it * cx + 2 * it * t * x1 + t * t * x,
          it * it * cy + 2 * it * t * y1 + t * t * y,
        ]);
      }
      cx = x; cy = y;
    } else if (T === "C") {
      const x1 = rel ? cx + a[0] : a[0];
      const y1 = rel ? cy + a[1] : a[1];
      const x2 = rel ? cx + a[2] : a[2];
      const y2 = rel ? cy + a[3] : a[3];
      const x = rel ? cx + a[4] : a[4];
      const y = rel ? cy + a[5] : a[5];
      for (let i = 1; i <= 4; i++) {
        const t = i / 4, it = 1 - t;
        pts.push([
          it * it * it * cx + 3 * it * it * t * x1 + 3 * it * t * t * x2 + t * t * t * x,
          it * it * it * cy + 3 * it * it * t * y1 + 3 * it * t * t * y2 + t * t * t * y,
        ]);
      }
      cx = x; cy = y;
    } else if (T === "Z") {
      // close-subpath returns to subpath start
      cx = startX; cy = startY;
    }
  }
  return pts;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
function bboxOfPoints(pts) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const [x, y] of pts) {
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  return [xmin, ymin, xmax, ymax];
}
// strict-inside (with epsilon margin) test for nesting via bbox
function bboxInside(inner, outer) {
  const eps = 0.5;
  return (
    inner[0] >= outer[0] - eps &&
    inner[1] >= outer[1] - eps &&
    inner[2] <= outer[2] + eps &&
    inner[3] <= outer[3] + eps
  );
}

/* Reverse the direction of a single subpath's commands, preserving any
   quadratic / cubic Bezier control points (so curve fidelity isn't lost).
   The trick: collect the sequence of "anchors" (M and end points of each
   command) plus the control points that go BEFORE each anchor; then walk it
   backward, where each anchor's incoming controls become its outgoing ones. */
function reverseSubpathCommands(commands) {
  // Convert relative to absolute first to make reversal sane.
  const abs = absolutizeCommands(commands);
  // Build segment list: each segment is { kind: 'L'|'Q'|'C', from:[x,y], to:[x,y], c1?, c2? }
  if (abs.length === 0) return commands;
  const segs = [];
  let startX = 0, startY = 0;
  let cx = 0, cy = 0;
  let hasZ = false;
  for (const c of abs) {
    if (c.type === "M") {
      cx = c.args[0]; cy = c.args[1];
      startX = cx; startY = cy;
    } else if (c.type === "L" || c.type === "H" || c.type === "V") {
      const tx = c.type === "H" ? c.args[0] : c.type === "V" ? cx : c.args[0];
      const ty = c.type === "V" ? c.args[0] : c.type === "H" ? cy : c.args[1];
      segs.push({ kind: "L", from: [cx, cy], to: [tx, ty] });
      cx = tx; cy = ty;
    } else if (c.type === "Q") {
      const c1 = [c.args[0], c.args[1]];
      const to = [c.args[2], c.args[3]];
      segs.push({ kind: "Q", from: [cx, cy], c1, to });
      cx = to[0]; cy = to[1];
    } else if (c.type === "C") {
      const c1 = [c.args[0], c.args[1]];
      const c2 = [c.args[2], c.args[3]];
      const to = [c.args[4], c.args[5]];
      segs.push({ kind: "C", from: [cx, cy], c1, c2, to });
      cx = to[0]; cy = to[1];
    } else if (c.type === "Z") {
      hasZ = true;
      // implicit closing segment
      if (cx !== startX || cy !== startY) {
        segs.push({ kind: "L", from: [cx, cy], to: [startX, startY] });
      }
      cx = startX; cy = startY;
    }
  }
  if (segs.length === 0) return commands;

  // Build reversed command list: start at last segment's end, walk backwards.
  const out = [];
  const last = segs[segs.length - 1].to;
  out.push({ type: "M", args: [last[0], last[1]] });
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.kind === "L") {
      out.push({ type: "L", args: [s.from[0], s.from[1]] });
    } else if (s.kind === "Q") {
      out.push({ type: "Q", args: [s.c1[0], s.c1[1], s.from[0], s.from[1]] });
    } else if (s.kind === "C") {
      // reversed cubic: same control points, swapped
      out.push({
        type: "C",
        args: [s.c2[0], s.c2[1], s.c1[0], s.c1[1], s.from[0], s.from[1]],
      });
    }
  }
  if (hasZ) out.push({ type: "Z", args: [] });
  return out;
}

// Convert a command list (with any relatives) into all-absolute form.
function absolutizeCommands(commands) {
  const out = [];
  let cx = 0, cy = 0, startX = 0, startY = 0;
  for (const c of commands) {
    const T = c.type.toUpperCase();
    const rel = c.type !== T;
    const a = c.args;
    if (T === "M") {
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      out.push({ type: "M", args: [x, y] });
      cx = x; cy = y; startX = x; startY = y;
    } else if (T === "L") {
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      out.push({ type: "L", args: [x, y] });
      cx = x; cy = y;
    } else if (T === "H") {
      const x = rel ? cx + a[0] : a[0];
      out.push({ type: "L", args: [x, cy] });
      cx = x;
    } else if (T === "V") {
      const y = rel ? cy + a[0] : a[0];
      out.push({ type: "L", args: [cx, y] });
      cy = y;
    } else if (T === "Q") {
      const x1 = rel ? cx + a[0] : a[0];
      const y1 = rel ? cy + a[1] : a[1];
      const x = rel ? cx + a[2] : a[2];
      const y = rel ? cy + a[3] : a[3];
      out.push({ type: "Q", args: [x1, y1, x, y] });
      cx = x; cy = y;
    } else if (T === "C") {
      const x1 = rel ? cx + a[0] : a[0];
      const y1 = rel ? cy + a[1] : a[1];
      const x2 = rel ? cx + a[2] : a[2];
      const y2 = rel ? cy + a[3] : a[3];
      const x = rel ? cx + a[4] : a[4];
      const y = rel ? cy + a[5] : a[5];
      out.push({ type: "C", args: [x1, y1, x2, y2, x, y] });
      cx = x; cy = y;
    } else if (T === "Z") {
      out.push({ type: "Z", args: [] });
      cx = startX; cy = startY;
    }
  }
  return out;
}

/* Append a list of (already-absolute or relative) commands to an opentype
   Path, applying the source→font-units transform. Same as the old
   svgPathToOpentype but appends instead of building a new Path. */
function appendCommandsToOpentypePath(path, commands, transform) {
  let cx = 0, cy = 0, startX = 0, startY = 0;
  for (const cmd of commands) {
    const T = cmd.type.toUpperCase();
    const rel = cmd.type !== T;
    const a = cmd.args;
    if (T === "M") {
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      path.moveTo(transform.x(x), transform.y(y));
      cx = x; cy = y; startX = x; startY = y;
    } else if (T === "L") {
      const x = rel ? cx + a[0] : a[0];
      const y = rel ? cy + a[1] : a[1];
      path.lineTo(transform.x(x), transform.y(y));
      cx = x; cy = y;
    } else if (T === "H") {
      const x = rel ? cx + a[0] : a[0];
      path.lineTo(transform.x(x), transform.y(cy));
      cx = x;
    } else if (T === "V") {
      const y = rel ? cy + a[0] : a[0];
      path.lineTo(transform.x(cx), transform.y(y));
      cy = y;
    } else if (T === "Q") {
      const x1 = rel ? cx + a[0] : a[0];
      const y1 = rel ? cy + a[1] : a[1];
      const x = rel ? cx + a[2] : a[2];
      const y = rel ? cy + a[3] : a[3];
      path.quadraticCurveTo(transform.x(x1), transform.y(y1), transform.x(x), transform.y(y));
      cx = x; cy = y;
    } else if (T === "C") {
      const x1 = rel ? cx + a[0] : a[0];
      const y1 = rel ? cy + a[1] : a[1];
      const x2 = rel ? cx + a[2] : a[2];
      const y2 = rel ? cy + a[3] : a[3];
      const x = rel ? cx + a[4] : a[4];
      const y = rel ? cy + a[5] : a[5];
      path.curveTo(
        transform.x(x1), transform.y(y1),
        transform.x(x2), transform.y(y2),
        transform.x(x), transform.y(y)
      );
      cx = x; cy = y;
    } else if (T === "Z") {
      path.close();
      cx = startX; cy = startY;
    }
  }
}

function buildGlyphFromTraced(char, traced) {
  // Source pixel space: (0,0)…(traced.bbox.w, traced.bbox.h), y-down.
  // Target font space: glyph fits inside `GLYPH_HEIGHT` units tall, baseline
  // at y=0 (or shifted DESCENDER for descender chars), y-up.
  const src = traced.bbox;
  const isDescender = DESCENDER_CHARS.has(char);
  const scale = GLYPH_HEIGHT / src.h;
  const targetW = src.w * scale;
  const base = isDescender ? -250 : 0;

  const transform = {
    x: (px) => px * scale,
    y: (py) => base + (src.h - py) * scale, // y-flip + offset
  };

  // 1. Parse every traced path string into per-subpath polylines so we can
  //    detect nesting (outer letter outline vs inner counter/hole).
  const subpaths = [];
  for (const d of traced.paths) {
    const cmds = parseSVGPathCommands(d);
    const subs = splitCommandsIntoSubpaths(cmds);
    for (const sub of subs) {
      const pts = commandsToPolyline(sub);
      if (pts.length < 3) continue; // skip degenerate
      subpaths.push({
        commands: sub,
        points: pts,
        area: signedArea(pts),
        bbox: bboxOfPoints(pts),
      });
    }
  }
  if (subpaths.length === 0) {
    return new opentype.Glyph({
      name: char,
      unicode: char.charCodeAt(0),
      advanceWidth: 500,
      path: new opentype.Path(),
    });
  }

  // 2. For each subpath, find the smallest other subpath that contains it.
  //    The depth (nesting count) decides whether it's an outer (even depth)
  //    or a hole (odd depth) — same rule SVG even-odd uses, but here we
  //    *enforce* it via direction so non-zero TTF rendering produces holes.
  for (const sp of subpaths) {
    let depth = 0;
    for (const cand of subpaths) {
      if (cand === sp) continue;
      if (
        Math.abs(cand.area) > Math.abs(sp.area) &&
        bboxInside(sp.bbox, cand.bbox)
      ) {
        depth++;
      }
    }
    sp.depth = depth;
  }

  // 3. Pick a canonical "outer" winding sign by majority vote across depth-0
  //    subpaths; everything at odd depth must wind opposite.
  const outers = subpaths.filter((s) => s.depth === 0);
  let outerSign = 0;
  for (const o of outers) outerSign += Math.sign(o.area);
  if (outerSign === 0) outerSign = Math.sign(outers[0]?.area || 1) || 1;

  // 4. Emit subpaths into the opentype Path, reversing where needed so each
  //    subpath ends up with the right winding direction for its depth.
  const path = new opentype.Path();
  for (const sp of subpaths) {
    const wantSign = sp.depth % 2 === 0 ? outerSign : -outerSign;
    const cmds =
      Math.sign(sp.area) === wantSign
        ? sp.commands
        : reverseSubpathCommands(sp.commands);
    appendCommandsToOpentypePath(path, cmds, transform);
  }

  return new opentype.Glyph({
    name: char,
    unicode: char.charCodeAt(0),
    advanceWidth: Math.max(200, Math.round(targetW + 80)),
    path,
  });
}

function assembleFont(extracted) {
  const glyphs = [];
  // .notdef must be glyph index 0
  glyphs.push(
    new opentype.Glyph({
      name: ".notdef",
      advanceWidth: 500,
      path: new opentype.Path(),
    })
  );
  // synthetic space — user can't draw "no ink"
  glyphs.push(
    new opentype.Glyph({
      name: "space",
      unicode: 32,
      advanceWidth: 350,
      path: new opentype.Path(),
    })
  );
  for (const g of extracted) {
    try {
      glyphs.push(buildGlyphFromTraced(g.char, g));
    } catch (e) {
      console.warn(`skipping ${g.char}: ${e.message}`);
    }
  }
  const font = new opentype.Font({
    familyName: "BoringDocsHandwriting",
    styleName: "Regular",
    unitsPerEm: UNITS_PER_EM,
    ascender: ASCENDER,
    descender: DESCENDER,
    glyphs,
  });
  return font.toArrayBuffer();
}

function arrayBufferToDataUrl(buf, mime) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  // chunk-encode to avoid call-stack limits with String.fromCharCode(...giant)
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    );
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

// pre-load handwriting fonts so html-to-image embeds them on first export
if (document.fonts && document.fonts.load) {
  Promise.all([
    document.fonts.load('700 56px "Caveat"'),
    document.fonts.load('400 26px "Caveat"'),
    document.fonts.load('400 22px "Patrick Hand"'),
    document.fonts.load('400 20px "Kalam"'),
    document.fonts.load('400 26px "Shadows Into Light"'),
  ]).catch(() => {});
}

// LLM provider state — readable everywhere via `currentProvider`. The user
// can flip between "local" and "openai" at runtime; the choice persists in
// localStorage and is sent with every conversion request as `provider`.
const PROVIDER_STORAGE = "boringdocs.llmProvider";
let serverHasKey = false;
let providerAvailability = { local: false, openai: true };
let providerModels = { local: "qwen2.5:3b", openai: "gpt-4o-mini" };
let currentProvider = localStorage.getItem(PROVIDER_STORAGE) || "local";

function syncProviderUI() {
  const localBtn = document.getElementById("providerLocalBtn");
  const openaiBtn = document.getElementById("providerOpenaiBtn");
  if (localBtn) {
    localBtn.classList.toggle("active", currentProvider === "local");
    localBtn.disabled = !providerAvailability.local;
    localBtn.title = providerAvailability.local
      ? `Run on local ${providerModels.local} (no key, free)`
      : "Local provider not configured — set LLM_BASE_URL in .env";
    const meta = document.getElementById("providerLocalMeta");
    if (meta) meta.textContent = providerModels.local || "—";
  }
  if (openaiBtn) {
    openaiBtn.classList.toggle("active", currentProvider === "openai");
    openaiBtn.disabled = !providerAvailability.openai;
    openaiBtn.title = `Run on OpenAI ${providerModels.openai}`;
    const meta = document.getElementById("providerOpenaiMeta");
    if (meta) meta.textContent = providerModels.openai || "—";
  }
  // Show the API-key field only when OpenAI is selected AND the server
  // doesn't already have a key from .env.
  const row = document.getElementById("keyModelRow");
  const hint = document.getElementById("apiKeyHint");
  if (row) {
    const needKey = currentProvider === "openai" && !serverHasKey;
    row.style.display = needKey ? "" : "none";
  }
  if (hint) {
    hint.innerHTML = `Stored only in your browser. Using <code>${providerModels.openai}</code>.`;
  }
}

function setProvider(p) {
  if (p !== "local" && p !== "openai") return;
  if (!providerAvailability[p]) return;
  currentProvider = p;
  localStorage.setItem(PROVIDER_STORAGE, p);
  syncProviderUI();
}

document.getElementById("providerLocalBtn")?.addEventListener("click", () => setProvider("local"));
document.getElementById("providerOpenaiBtn")?.addEventListener("click", () => setProvider("openai"));

fetch("/api/config")
  .then((r) => r.json())
  .then((cfg) => {
    serverHasKey = !!cfg.hasServerKey;
    const local = cfg.llm?.providers?.local;
    const openai = cfg.llm?.providers?.openai;
    providerAvailability = {
      local: !!local?.available,
      openai: !!openai?.available,
    };
    providerModels = {
      local: local?.model || providerModels.local,
      openai: openai?.model || providerModels.openai,
    };
    // If the user's saved choice is no longer available, fall back to the
    // server's preferred default.
    if (!providerAvailability[currentProvider]) {
      currentProvider = cfg.llm?.default || (providerAvailability.local ? "local" : "openai");
      localStorage.setItem(PROVIDER_STORAGE, currentProvider);
    }
    syncProviderUI();
  })
  .catch(() => syncProviderUI());

const setStatus = (msg) => (statusEl.textContent = msg || "");
const setBusy = (busy) => {
  goBtn.disabled = busy;
  // Show / hide the live "running on <model>" badge so the user has
  // visual confirmation of which provider is actually executing this
  // conversion. Provider pills are also locked during the request — flipping
  // mid-flight wouldn't affect the in-flight call anyway.
  const badge = document.getElementById("activeModelBadge");
  const badgeText = document.getElementById("activeModelBadgeText");
  const localBtn = document.getElementById("providerLocalBtn");
  const openaiBtn = document.getElementById("providerOpenaiBtn");
  if (badge) badge.style.display = busy ? "" : "none";
  if (badgeText && busy) {
    badgeText.textContent = `running on ${providerModels[currentProvider] || currentProvider}`;
  }
  if (localBtn) localBtn.disabled = busy || !providerAvailability.local;
  if (openaiBtn) openaiBtn.disabled = busy || !providerAvailability.openai;
  if (!busy) {
    applyInputMode();
    return;
  }
  if (inputMode === "topic") {
    const url = urlInput?.value?.trim();
    if (url)
      goBtn.innerHTML = crawlChk.checked
        ? iconLabel("globe", "crawling…")
        : iconLabel("pencil", "scribbling…");
    else if (selectedFileKind === "pdf")
      goBtn.innerHTML = iconLabel("book-open", "extracting…");
    else
      goBtn.innerHTML = iconLabel("search", "finding docs…");
  } else if (inputMode === "youtube") {
    goBtn.innerHTML = iconLabel("play", "transcribing…");
  }
};
const setProgress = (pct, text) => {
  progressEl.style.display = "";
  progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  progressText.textContent = text || "";
};
const hideProgress = () => {
  progressEl.style.display = "none";
};

goBtn.addEventListener("click", async () => {
  const apiKey = keyInput.value.trim();
  const model = providerModels[currentProvider] || DEFAULT_MODEL;

  // OpenAI provider needs a key (pasted or in .env). The local provider
  // (Ollama) never does.
  if (currentProvider === "openai" && !apiKey && !serverHasKey)
    return setStatus("paste an OpenAI API key (or switch to Local).");

  // The modal stays OPEN during conversion so the user can see the
  // progress bar and status updates inside it. It closes automatically
  // once setNoteView(true) flips the page into reader mode (i.e. once
  // the conversion has produced renderable papers).
  if (inputMode === "topic") {
    const url = urlInput.value.trim();
    if (url) {
      setBusy(true);
      setDownloadEnabled(false);
      resetPapers();
      try {
        if (crawlChk.checked) {
          await runPickerThenConvert({
            url,
            apiKey,
            model,
            maxPages: Number(maxPagesInput.value) || 30,
          });
        } else {
          await runSingleMode({ url, apiKey, model });
        }
      } catch (err) {
        console.error(err);
        setStatus("");
        showError(err.message || String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (selectedFile) {
      setBusy(true);
      setDownloadEnabled(false);
      resetPapers();
      try {
        await runPdfMode({ file: selectedFile, apiKey, model });
      } catch (err) {
        console.error(err);
        setStatus("");
        showError(err.message || String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    const topic = topicInput.value.trim();
    if (!topic) return setStatus("type a topic, paste a URL, or drop in a PDF.");
    const pages = Math.max(1, Math.min(15, Number(topicPagesInput.value) || 5));
    setBusy(true);
    setDownloadEnabled(false);
    resetPapers();
    try {
      await runPickerThenConvert({
        topic,
        apiKey,
        model,
        maxPages: pages,
      });
    } catch (err) {
      console.error(err);
      setStatus("");
      showError(err.message || String(err));
    } finally {
      setBusy(false);
    }
    return;
  }

  if (inputMode === "youtube") {
    const ytUrl = youtubeInput.value.trim();
    if (!ytUrl) return setStatus("paste a YouTube video URL first.");
    setBusy(true);
    setDownloadEnabled(false);
    resetPapers();
    try {
      await runYoutubeMode({ url: ytUrl, apiKey, model });
    } catch (err) {
      console.error(err);
      setStatus("");
      showError(err.message || String(err));
    } finally {
      setBusy(false);
    }
    return;
  }
});

/**
 * Discover candidate pages, let the user check off which ones to convert,
 * then run the conversion with the selected pages.
 */
async function runPickerThenConvert({ url, topic, apiKey, model, maxPages }) {
  // ---- Step 1: discover ----
  if (topic) {
    setStatus(`finding official docs for "${topic}"…`);
    setProgress(2, "starting…");
  } else {
    setStatus("crawling docs site…");
    setProgress(2, "starting…");
  }

  let discovery;
  try {
    discovery = await discoverPages({ url, topic, apiKey, model, maxPages });
  } catch (err) {
    hideProgress();
    throw err;
  }

  hideProgress();

  if (!discovery.pages.length) {
    throw new Error(
      topic
        ? `Couldn't find any pages for "${topic}".`
        : "Couldn't discover any pages on that site."
    );
  }

  // ---- Step 2: ask the user which pages to convert ----
  setStatus(`found ${discovery.pages.length} pages — pick which to convert…`);
  const selection = await showPagePicker(discovery.pages, {
    topic,
    rootUrl: discovery.rootUrl,
  });
  if (!selection) {
    setStatus("cancelled");
    return;
  }
  const { pages: selectedPages, folder: chosenFolder } = selection;
  if (!selectedPages.length) {
    setStatus("nothing selected");
    return;
  }

  // ---- Step 3: convert only the picked pages ----
  await runCrawlMode({
    url,
    topic,
    apiKey,
    model,
    maxPages,
    pages: selectedPages,
    folder: chosenFolder,
  });
}

/**
 * Streams /api/discover-pages and returns { pages, rootUrl, topic }.
 * Updates the live status so the user sees crawl progress.
 */
async function discoverPages({ url, topic, apiKey, model, maxPages }) {
  const res = await fetch("/api/discover-pages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, topic, apiKey, model, maxPages, provider: currentProvider }),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pages = [];
  let rootUrl = null;
  let outTopic = topic || null;
  let count = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }

      switch (evt.type) {
        case "phase":
          if (evt.phase === "resolving-topic") {
            setStatus(`finding official docs for "${evt.topic}"…`);
            setProgress(8, "asking the model for a reading list…");
          } else if (evt.phase === "crawling") {
            setStatus(`crawling up to ${evt.cap} pages…`);
            setProgress(10, "crawling…");
          }
          break;
        case "resolver-step":
          setStatus(evt.message || "resolving…");
          break;
        case "topic-resolved":
          outTopic = evt.topic || outTopic;
          if (evt.rootUrl) rootUrl = evt.rootUrl;
          setStatus(`reading list ready (${(evt.pages || []).length} pages)`);
          break;
        case "fetching": {
          try {
            const u = new URL(evt.url);
            setStatus(`fetching ${u.pathname || u.host}…`);
          } catch {
            setStatus("fetching…");
          }
          break;
        }
        case "fetched":
          count = evt.n;
          setProgress(
            10 + Math.min(60, count * 4),
            `discovered ${count} page${count === 1 ? "" : "s"}…`
          );
          break;
        case "skipped":
          console.warn("skipped:", evt.url, evt.reason);
          break;
        case "fetch-error":
          console.warn("fetch error:", evt.url, evt.error);
          break;
        case "discovered":
          pages = evt.pages || [];
          if (evt.rootUrl) rootUrl = evt.rootUrl;
          if (evt.topic) outTopic = evt.topic;
          setProgress(80, `${pages.length} pages discovered`);
          break;
        case "error":
          throw new Error(evt.error || "discovery failed");
      }
    }
  }

  return { pages, rootUrl, topic: outTopic };
}

/**
 * Shows a modal with one row per discovered page.
 * Resolves to an array of { url, title } the user picked, or null if cancelled.
 */
function showPagePicker(pages, { topic, rootUrl } = {}) {
  return new Promise((resolve) => {
    const state = pages.map((p) => ({
      url: p.url,
      title: p.title || p.url,
      checked: true,
    }));
    let chosenFolder = null; // null = Uncategorized, otherwise folder name

    function syncFolderLabel() {
      if (!pickerFolderLabel) return;
      pickerFolderLabel.textContent = chosenFolder
        ? `Save to: ${chosenFolder}`
        : "Save to: Uncategorized";
    }
    syncFolderLabel();

    // Fire-and-forget: load known folder names so the picker shows them.
    let knownFolders = [];
    fetch("/api/folders")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.folders)) knownFolders = d.folders;
      })
      .catch(() => {});

    async function onPickFolder() {
      // Reuses the styled folder-picker we built earlier so the look + flow
      // matches the rest of the app (My notes, Save).
      const picked = await showFolderPicker({
        title: "Save converted notes to…",
        message: "Pick a folder for the notes we'll generate from these pages.",
        folders: knownFolders,
        currentFolder: chosenFolder,
      });
      if (picked === undefined) return; // user cancelled the folder picker
      chosenFolder = picked || null;
      // server creates folder on PATCH/SAVE if it's new — track locally too
      if (chosenFolder && !knownFolders.includes(chosenFolder)) {
        knownFolders = [...knownFolders, chosenFolder].sort((a, b) =>
          a.localeCompare(b)
        );
      }
      syncFolderLabel();
    }

    function renderList() {
      pickerListEl.innerHTML = "";
      if (!state.length) {
        pickerListEl.innerHTML =
          '<div class="picker-empty">No pages found.</div>';
        return;
      }
      for (let i = 0; i < state.length; i++) {
        const row = document.createElement("label");
        row.className = "picker-row" + (state[i].checked ? " checked" : "");
        row.dataset.idx = String(i);
        let displayUrl = state[i].url;
        try {
          const u = new URL(state[i].url);
          displayUrl = u.host + u.pathname;
        } catch {}
        row.innerHTML = `
          <input type="checkbox" ${state[i].checked ? "checked" : ""} />
          <div class="picker-row-main">
            <p class="picker-row-title">${escapeHtml(state[i].title)}</p>
            <div class="picker-row-url">${escapeHtml(displayUrl)}</div>
          </div>
        `;
        pickerListEl.appendChild(row);
      }
    }
    function updateCount() {
      const n = state.filter((s) => s.checked).length;
      pickerCountEl.textContent = `${n} selected`;
      pickerConfirmBtn.disabled = n === 0;
    }
    function syncRowVisuals() {
      [...pickerListEl.querySelectorAll(".picker-row")].forEach((row, i) => {
        const cb = row.querySelector('input[type="checkbox"]');
        cb.checked = state[i].checked;
        row.classList.toggle("checked", state[i].checked);
      });
    }

    const subParts = [];
    if (topic) subParts.push(`for <strong>${escapeHtml(topic)}</strong>`);
    if (rootUrl) {
      try {
        subParts.push(`from <code>${escapeHtml(new URL(rootUrl).host)}</code>`);
      } catch {}
    }
    pickerSubEl.innerHTML = subParts.length
      ? `Tick the pages you want — we'll only convert those ${subParts.join(" ")}.`
      : "Tick the pages you want — we'll only convert those.";

    renderList();
    updateCount();

    function onListClick(e) {
      const row = e.target.closest(".picker-row");
      if (!row) return;
      const idx = Number(row.dataset.idx);
      if (!Number.isFinite(idx)) return;
      // The label wraps the checkbox, so a single click toggles state once.
      // Use requestAnimationFrame so we read the post-toggle value.
      requestAnimationFrame(() => {
        const cb = row.querySelector('input[type="checkbox"]');
        state[idx].checked = !!cb.checked;
        row.classList.toggle("checked", state[idx].checked);
        updateCount();
      });
    }
    function onSelectAll() {
      state.forEach((s) => (s.checked = true));
      syncRowVisuals();
      updateCount();
    }
    function onSelectNone() {
      state.forEach((s) => (s.checked = false));
      syncRowVisuals();
      updateCount();
    }
    function onConfirm() {
      const picked = state
        .filter((s) => s.checked)
        .map(({ url, title }) => ({ url, title }));
      cleanup();
      resolve({ pages: picked, folder: chosenFolder });
    }
    function onCancel() {
      cleanup();
      resolve(null);
    }
    function onBackdrop(e) {
      if (e.target === pickerModal) onCancel();
    }
    function onKey(e) {
      if (e.key === "Escape") onCancel();
    }

    function cleanup() {
      pickerModal.style.display = "none";
      pickerListEl.removeEventListener("click", onListClick);
      pickerSelectAllBtn.removeEventListener("click", onSelectAll);
      pickerSelectNoneBtn.removeEventListener("click", onSelectNone);
      pickerFolderBtn?.removeEventListener("click", onPickFolder);
      pickerConfirmBtn.removeEventListener("click", onConfirm);
      pickerCancelBtn.removeEventListener("click", onCancel);
      pickerCloseBtn.removeEventListener("click", onCancel);
      pickerModal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
    }

    pickerListEl.addEventListener("click", onListClick);
    pickerSelectAllBtn.addEventListener("click", onSelectAll);
    pickerSelectNoneBtn.addEventListener("click", onSelectNone);
    pickerFolderBtn?.addEventListener("click", onPickFolder);
    pickerConfirmBtn.addEventListener("click", onConfirm);
    pickerCancelBtn.addEventListener("click", onCancel);
    pickerCloseBtn.addEventListener("click", onCancel);
    pickerModal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);

    pickerModal.style.display = "flex";
  });
}

async function runYoutubeMode({ url, apiKey, model }) {
  setStatus("fetching transcript & asking the model…");
  const res = await fetch("/api/convert-youtube", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, apiKey, model, provider: currentProvider }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  const sourceId = appendNotesPaper(data.notes, data.sourceUrl, data.sourceTitle);
  currentSession.sourceUrl = data.sourceUrl;
  currentSession.papers.push({
    sourceId,
    notes: data.notes,
    sourceUrl: data.sourceUrl,
    sourceTitle: data.sourceTitle,
  });
  setStatus("done ✓");
  setDownloadEnabled(true);
  showReaderBar();
}

async function runPdfMode({ file, apiKey, model }) {
  if (typeof window.pdfjsLib === "undefined") {
    throw new Error("PDF library failed to load. Refresh the page and try again.");
  }
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";

  setStatus("extracting text from PDF…");
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const chunks = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    setStatus(`extracting page ${i} / ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const pageText = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    if (pageText.trim()) chunks.push(pageText);
  }
  const text = chunks.join("\n\n").trim();
  if (text.length < 40) {
    throw new Error(
      "Couldn't extract enough text from this PDF. If it's a scan, you'll need an OCR'd version."
    );
  }
  // Strip the .pdf extension for the title; fallback to filename as-is.
  const title = file.name.replace(/\.pdf$/i, "") || "PDF document";

  setStatus("asking the model to convert your PDF…");
  const res = await fetch("/api/convert-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, text, apiKey, model, sourceKind: "pdf", provider: currentProvider }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  const sourceId = appendNotesPaper(data.notes, data.sourceUrl, data.sourceTitle);
  currentSession.sourceUrl = data.sourceUrl || null;
  currentSession.papers.push({
    sourceId,
    notes: data.notes,
    sourceUrl: data.sourceUrl || null,
    sourceTitle: data.sourceTitle,
  });
  setStatus("done ✓");
  setDownloadEnabled(true);
  showReaderBar();
}

async function runSingleMode({ url, apiKey, model }) {
  setStatus("fetching the page & asking the model…");
  const res = await fetch("/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, apiKey, model, provider: currentProvider }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  const sourceId = appendNotesPaper(data.notes, data.sourceUrl, data.sourceTitle);
  currentSession.sourceUrl = url;
  currentSession.papers.push({
    sourceId,
    notes: data.notes,
    sourceUrl: data.sourceUrl,
    sourceTitle: data.sourceTitle,
  });
  setStatus("done ✓");
  setDownloadEnabled(true);
  showReaderBar();
}

async function runCrawlMode({ url, topic, apiKey, model, maxPages, pages, folder = null }) {
  currentSession.topic = topic || null;
  currentSession.sourceUrl = url || null;
  currentSession.folder = folder || null;
  const usingPreset = Array.isArray(pages) && pages.length > 0;
  if (usingPreset) {
    setStatus(`converting ${pages.length} page${pages.length === 1 ? "" : "s"}…`);
  } else if (topic) {
    setStatus("finding official docs for that topic…");
  } else {
    setStatus("crawling docs site…");
  }
  setProgress(2, "starting…");

  const res = await fetch("/api/convert-site", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, topic, apiKey, model, maxPages, pages, provider: currentProvider }),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }

  // build TOC paper up-front so users can see progress filling in
  const toc = buildTocPaper();
  papersEl.innerHTML = "";
  papersEl.appendChild(toc.element);
  paperWrap.classList.remove("empty");
  if (usingPreset) {
    for (const p of pages) toc.addPending(p.url, p.title);
  }
  renumberPages();
  showReaderBar();

  let totalToConvert = 0;
  let pagesDone = 0;
  let pagesFetched = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      handleEvent(evt);
    }
  }

  function handleEvent(evt) {
    switch (evt.type) {
      case "phase":
        if (evt.phase === "resolving-topic") {
          setStatus(`finding official docs for "${evt.topic}"…`);
          setProgress(8, "asking model for a reading list…");
        } else if (evt.phase === "fetching") {
          setStatus(`fetching ${evt.total} page${evt.total === 1 ? "" : "s"}…`);
          setProgress(15, `fetching ${evt.total} pages`);
        } else if (evt.phase === "crawling") {
          setStatus(`crawling up to ${evt.cap} pages…`);
        } else if (evt.phase === "converting") {
          totalToConvert = evt.total;
          setStatus(`converting ${evt.total} page${evt.total === 1 ? "" : "s"}…`);
          setProgress(20, `0 / ${evt.total} pages converted`);
        }
        break;
      case "resolver-step":
        setStatus(evt.message || "resolving…");
        break;
      case "topic-resolved": {
        // pre-populate the TOC with the planned reading list
        for (const p of evt.pages || []) {
          toc.addPending(p.url, p.title);
        }
        const root = evt.rootUrl ? ` (${evt.rootUrl})` : "";
        setStatus(`reading list ready${root}`);
        break;
      }
      case "fetching": {
        // show the current URL being fetched so the user sees liveness
        try {
          const u = new URL(evt.url);
          setStatus(`fetching ${u.pathname || u.host}…`);
        } catch {
          setStatus("fetching…");
        }
        break;
      }
      case "fetched":
        pagesFetched = evt.n;
        setProgress(
          5 + Math.min(15, evt.n),
          `fetched ${evt.n} page${evt.n === 1 ? "" : "s"} (queue: ${evt.queued})`
        );
        toc.addPending(evt.url, evt.title);
        break;
      case "skipped":
        console.warn("skipped:", evt.url, evt.reason);
        toc.markError(evt.url, `skipped: ${evt.reason || "thin content"}`);
        break;
      case "fetch-error":
        console.warn("fetch error:", evt.url, evt.error);
        if (evt.url) toc.markError(evt.url, `fetch failed: ${evt.error}`);
        break;
      case "page": {
        pagesDone = evt.completed;
        const pct =
          20 + (totalToConvert ? (75 * pagesDone) / totalToConvert : 0);
        setProgress(
          pct,
          `${pagesDone} / ${totalToConvert} pages converted`
        );
        const id = appendNotesPaper(evt.notes, evt.url, evt.sourceTitle);
        currentSession.papers.push({
          sourceId: id,
          notes: evt.notes,
          sourceUrl: evt.url,
          sourceTitle: evt.sourceTitle,
        });
        toc.markDone(evt.url, evt.notes?.title || evt.sourceTitle, id);
        break;
      }
      case "page-error":
        console.warn("page error:", evt.url, evt.error);
        toc.markError(evt.url, evt.error);
        break;
      case "done":
        setProgress(100, `done — ${pagesDone} / ${evt.total} pages converted`);
        setStatus("done ✓");
        setDownloadEnabled(true);
        setTimeout(hideProgress, 2200);
        break;
      case "error":
        throw new Error(evt.error || "unknown error");
    }
  }
}

/* ------------------ export (PNG / PDF) ------------------ */
// html-to-image preserves SVG (rough.js doodles), CSS transforms, and gradients
// far better than html2canvas does.

async function readyForCapture() {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch {}
  }
  // give the browser two frames to settle layout/paint
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
}

// Strip transient UI state (book mode, flip animations, inline height) so
// the export captures every page in its natural scrolled-out state, then
// restore everything when done.
function enterCleanCaptureMode() {
  const wasBook = papersEl.classList.contains("book-mode");
  const inlineHeight = papersEl.style.height;
  papersEl.classList.remove("book-mode");
  papersEl.classList.add("capturing");
  papersEl.style.height = "";

  const papers = [...papersEl.querySelectorAll(".paper")];
  const restoreFlips = papers.map((p) => {
    const flips = ["flip-out", "flip-in"].filter((c) =>
      p.classList.contains(c)
    );
    flips.forEach((c) => p.classList.remove(c));
    const wasActive = p.classList.contains("active");
    return { p, flips, wasActive };
  });

  return () => {
    if (wasBook) papersEl.classList.add("book-mode");
    papersEl.classList.remove("capturing");
    if (inlineHeight) papersEl.style.height = inlineHeight;
    restoreFlips.forEach(({ p, flips }) => flips.forEach((c) => p.classList.add(c)));
  };
}

/* Browser print: opens the system print dialog. The @media print stylesheet
   in styles.css fixes width at 210mm and lets each .paper grow naturally
   (one paper per sheet, no mid-bullet cuts). enterCleanCaptureMode strips
   transient flip-animation state so a freshly-flipped page in book view
   doesn't print mid-flip. */
function printNotes() {
  if (printBtn?.disabled) return;
  if (!pageList().length) return setStatus("nothing to print yet.");
  const restore = enterCleanCaptureMode();
  // Need to wait two frames after the class changes so layout settles before
  // the browser snapshots the document for print.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        window.print();
      } finally {
        restore();
      }
    });
  });
}
printBtn?.addEventListener("click", printNotes);

dlPngBtn.addEventListener("click", async () => {
  if (!window.htmlToImage) {
    return setStatus("image lib not loaded — refresh the page");
  }
  setStatus("preparing PNG…");
  const restore = enterCleanCaptureMode();
  try {
    await readyForCapture();
    setStatus("rendering PNG…");
    const dataUrl = await window.htmlToImage.toPng(papersEl, {
      backgroundColor: "#f3eee2",
      pixelRatio: 2,
      cacheBust: true,
      style: { transform: "none" },
    });
    const a = document.createElement("a");
    a.download = "boring-docs-notes.png";
    a.href = dataUrl;
    a.click();
    setStatus("saved PNG ✓");
  } catch (err) {
    console.error(err);
    setStatus("couldn't render PNG — check console");
  } finally {
    restore();
  }
});

dlPdfBtn.addEventListener("click", async () => {
  const papers = [...papersEl.querySelectorAll(".paper")].filter(
    (p) => !p.dataset.placeholder
  );
  if (!papers.length) return setStatus("nothing to export yet.");
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return setStatus("PDF library not loaded — refresh the page");
  }
  if (!window.htmlToImage) {
    return setStatus("image library not loaded — refresh the page");
  }
  const { jsPDF } = window.jspdf;

  // Page width is fixed at 210mm (A4 width). Height is allowed to grow with
  // content — we DO NOT slice tall papers across multiple A4 sheets, since
  // that cuts content mid-bullet/mid-paragraph. Each .paper becomes one
  // PDF page at its natural aspect-ratio.
  const PAGE_W_MM = 210;
  // Cap at jsPDF's hard maximum so it doesn't reject the document.
  const PAGE_MAX_H_MM = 14400; // ~14.4 m, jsPDF's documented page-size ceiling

  setStatus("preparing PDF…");
  const restore = enterCleanCaptureMode();
  let doc = null;
  let pdfPageCount = 0;

  const loadImg = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  // First-pass render so we know each page's required height before
  // constructing the jsPDF (its first page must be created with a size).
  const renders = [];
  try {
    await readyForCapture();
    for (let i = 0; i < papers.length; i++) {
      setStatus(`rendering page ${i + 1} / ${papers.length}…`);
      const p = papers[i];
      const dataUrl = await window.htmlToImage.toJpeg(p, {
        quality: 0.92,
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#fdfaf2",
        style: { transform: "none" },
      });
      const img = await loadImg(dataUrl);
      const heightMm = Math.min(
        PAGE_MAX_H_MM,
        (img.naturalHeight / img.naturalWidth) * PAGE_W_MM
      );
      renders.push({ dataUrl, heightMm });
    }
    if (!renders.length) throw new Error("nothing rendered");

    // Page 1: construct the doc sized for the first paper. Subsequent papers
    // each get an addPage() with their own custom [width, height] format,
    // so the PDF is one continuous-height page per logical paper — no cuts.
    doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [PAGE_W_MM, renders[0].heightMm],
      compress: true,
    });
    doc.addImage(renders[0].dataUrl, "JPEG", 0, 0, PAGE_W_MM, renders[0].heightMm);
    pdfPageCount = 1;
    for (let i = 1; i < renders.length; i++) {
      doc.addPage([PAGE_W_MM, renders[i].heightMm], "portrait");
      doc.addImage(renders[i].dataUrl, "JPEG", 0, 0, PAGE_W_MM, renders[i].heightMm);
      pdfPageCount++;
    }
    doc.save("boring-docs-notes.pdf");
    setStatus(
      `saved PDF (${pdfPageCount} page${pdfPageCount === 1 ? "" : "s"}, full content per page) ✓`
    );
  } catch (err) {
    console.error(err);
    setStatus("couldn't render PDF — check console");
  } finally {
    restore();
  }
});

/* ---------------- view modes (scroll / book) ---------------- */

let bookMode = false;
let currentPage = 0; // 0-indexed within visible papers

const VIEW_STORAGE = "boringdocs.view";
if (localStorage.getItem(VIEW_STORAGE) === "book") {
  // we'll switch into book mode the first time content arrives
}

viewScrollBtn.addEventListener("click", () => setViewMode("scroll"));
viewBookBtn.addEventListener("click", () => setViewMode("book"));
prevBtn.addEventListener("click", () => goToPage(currentPage - 1));
nextBtn.addEventListener("click", () => goToPage(currentPage + 1));
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  // Always-on shortcuts
  if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
    e.preventDefault();
    toggleShortcuts();
    return;
  }
  if (e.key === "Escape") {
    if (jumpMenuEl && !jumpMenuEl.hidden) {
      hideJumpMenu();
      return;
    }
    if (shortcutsModal?.style.display === "flex") {
      shortcutsModal.style.display = "none";
      return;
    }
    if (fontModal?.style.display === "flex") {
      fontModal.style.display = "none";
      return;
    }
  }
  if (e.key === "l" || e.key === "L") {
    if (libraryModal.style.display !== "flex") {
      e.preventDefault();
      openLibrary();
      return;
    }
  }
  // Reader-only shortcuts: only when notes are visible
  const readerVisible = readerBar.style.display !== "none";
  if (!readerVisible) return;

  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    toggleFullscreen();
    return;
  }
  if (e.key === "p" || e.key === "P") {
    // Don't swallow the OS-level print combo (Cmd+P / Ctrl+P) — let that
    // through unmodified; only intercept a bare "p".
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      printNotes();
      return;
    }
  }
  if (e.key === "b" || e.key === "B") {
    e.preventDefault();
    setViewMode(bookMode ? "scroll" : "book");
    return;
  }
  if (e.key === "t" || e.key === "T") {
    e.preventDefault();
    toggleJumpMenu();
    return;
  }
  // Page navigation works in BOTH modes now (used to be book-only)
  if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") {
    e.preventDefault();
    goToPage(currentPage - 1);
    return;
  }
  if (e.key === "ArrowRight" || e.key === "j" || e.key === "J" || e.key === " ") {
    e.preventDefault();
    goToPage(currentPage + 1);
    return;
  }
  if (e.key === "Home") {
    e.preventDefault();
    goToPage(0);
    return;
  }
  if (e.key === "End") {
    e.preventDefault();
    goToPage(pageList().length - 1);
    return;
  }
  if (e.key === "g") {
    e.preventDefault();
    goToPage(0);
    return;
  }
  if (e.key === "G") {
    e.preventDefault();
    goToPage(pageList().length - 1);
    return;
  }
  // Number keys jump to that page
  if (/^[1-9]$/.test(e.key)) {
    e.preventDefault();
    goToPage(Number(e.key) - 1);
    return;
  }
});

/* ---------------- fullscreen ---------------- */
fsBtn?.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFsButton);
document.addEventListener("webkitfullscreenchange", updateFsButton);

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function toggleFullscreen() {
  if (isFullscreen()) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  } else {
    const req =
      readerContainer.requestFullscreen ||
      readerContainer.webkitRequestFullscreen;
    if (req) req.call(readerContainer);
  }
}
function updateFsButton() {
  const inFs = isFullscreen();
  fsBtn.innerHTML =
    iconSvg(inFs ? "minimize" : "maximize") +
    `<span>${inFs ? "Exit" : "Fullscreen"}</span>`;
  fsBtn.title = inFs ? "Exit fullscreen (Esc)" : "Toggle fullscreen (F)";
  // when leaving fullscreen, always close the floating popover
  if (!inFs) readerContainer.classList.remove("controls-open");
  syncFsFabPage();
  // book mode height needs to recalculate based on the fullscreen viewport
  if (bookMode) requestAnimationFrame(() => syncBookHeight());
}

/* fullscreen floating action button → toggles the reader controls */
fsFab?.addEventListener("click", (e) => {
  e.stopPropagation();
  readerContainer.classList.toggle("controls-open");
});

/* clicking outside the popover (anywhere on the paper) closes the controls */
document.addEventListener("click", (e) => {
  if (!isFullscreen()) return;
  if (!readerContainer.classList.contains("controls-open")) return;
  if (e.target.closest(".reader-bar")) return;
  if (e.target.closest(".fs-fab")) return;
  readerContainer.classList.remove("controls-open");
});

/* ---------------- jump-to-page popover ---------------- */
jumpBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleJumpMenu();
});
document.addEventListener("click", (e) => {
  if (!jumpMenuEl || jumpMenuEl.hidden) return;
  if (e.target.closest("#jumpWrap")) return;
  hideJumpMenu();
});

function toggleJumpMenu() {
  if (!jumpMenuEl) return;
  if (jumpMenuEl.hidden) showJumpMenu();
  else hideJumpMenu();
}
function showJumpMenu() {
  if (!jumpMenuEl || pageList().length === 0) return;
  rebuildJumpMenu();
  jumpMenuEl.hidden = false;
  jumpBtn?.setAttribute("aria-expanded", "true");
}
function hideJumpMenu() {
  if (!jumpMenuEl) return;
  jumpMenuEl.hidden = true;
  jumpBtn?.setAttribute("aria-expanded", "false");
}
function rebuildJumpMenu() {
  if (!jumpMenuEl) return;
  const pages = pageList();
  if (!pages.length) {
    jumpMenuEl.innerHTML = "";
    return;
  }
  // Pull a friendly title for each paper: prefer the rendered title, else the
  // dataset.sourceLabel set when the paper was created, else "Page N".
  const labels = pages.map((p, i) => {
    const titleEl = p.querySelector(".notes h1.title, .notes h2, .notes h1");
    const fromTitle = titleEl?.textContent?.trim();
    const fromLabel = p.dataset.sourceLabel?.trim();
    return fromTitle || fromLabel || `Page ${i + 1}`;
  });
  jumpMenuEl.innerHTML = labels
    .map(
      (label, i) => `
        <button type="button" class="jump-item${i === currentPage ? " active" : ""}" data-idx="${i}" role="option">
          <span class="jump-item-num">${i + 1}</span>
          <span class="jump-item-label">${escapeHtml(label)}</span>
        </button>
      `
    )
    .join("");
  jumpMenuEl.querySelectorAll(".jump-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      if (Number.isFinite(idx)) goToPage(idx);
      hideJumpMenu();
    });
  });
}

/* ---------------- shortcuts modal ---------------- */
shortcutsBtn?.addEventListener("click", toggleShortcuts);
closeShortcutsBtn?.addEventListener("click", () => {
  if (shortcutsModal) shortcutsModal.style.display = "none";
});
shortcutsModal?.addEventListener("click", (e) => {
  if (e.target === shortcutsModal) shortcutsModal.style.display = "none";
});
function toggleShortcuts() {
  if (!shortcutsModal) return;
  shortcutsModal.style.display =
    shortcutsModal.style.display === "flex" ? "none" : "flex";
}

function syncFsFabPage() {
  if (!fsFabPage) return;
  if (!isFullscreen()) {
    fsFabPage.textContent = "";
    return;
  }
  const pages = pageList();
  if (!pages.length) {
    fsFabPage.textContent = "";
    return;
  }
  fsFabPage.textContent = `${currentPage + 1} / ${pages.length}`;
}

function setViewMode(mode) {
  bookMode = mode === "book";
  viewScrollBtn.classList.toggle("active", !bookMode);
  viewBookBtn.classList.toggle("active", bookMode);
  bookNav.style.display = bookMode ? "" : "none";
  papersEl.classList.toggle("book-mode", bookMode);
  localStorage.setItem(VIEW_STORAGE, mode);
  if (bookMode) {
    const pages = pageList();
    pages.forEach((p, i) => p.classList.toggle("active", i === currentPage));
    syncBookHeight();
  } else {
    papersEl.style.height = "";
    const pages = pageList();
    pages.forEach((p) => p.classList.remove("active", "flip-out", "flip-in"));
  }
  updatePageIndicator();
}

function syncBookHeight() {
  if (!bookMode) {
    papersEl.style.height = "";
    return;
  }
  const pages = pageList();
  const active = pages[currentPage];
  if (active) {
    // small delay so newly-added papers have laid out
    requestAnimationFrame(() => {
      papersEl.style.height = active.offsetHeight + "px";
    });
  }
}

function showReaderBar() {
  readerBar.style.display = "";
  // restore preferred mode
  if (localStorage.getItem(VIEW_STORAGE) === "book" && !bookMode) {
    setViewMode("book");
  } else {
    updatePageIndicator();
  }
}

/* Note view: when notes are loaded we switch the page into a dedicated reading
   view that hides the home content (hero, form, how-it-works, footer) and
   shows a "Back" button in the topbar. Browser back/forward also works via
   the History API, so closing a note feels like leaving a real page. */
let viewingNote = false;

function setNoteView(on, { pushHistory = true } = {}) {
  viewingNote = !!on;
  document.body.classList.toggle("viewing-note", viewingNote);
  if (backHomeBtn) backHomeBtn.style.display = viewingNote ? "" : "none";

  if (pushHistory) {
    if (viewingNote && history.state?.view !== "note") {
      history.pushState({ view: "note" }, "", "#note");
    } else if (!viewingNote && history.state?.view === "note") {
      history.pushState({ view: "home" }, "", location.pathname + location.search);
    }
  }

  if (viewingNote) {
    // Conversion succeeded (or a saved note was opened) — close the composer
    // modal now so the reader gets the full screen. We deliberately wait
    // until this point rather than closing on click, so the user can watch
    // the progress bar and status updates inside the modal while the model
    // is running.
    closeComposerModal();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

backHomeBtn?.addEventListener("click", goHome);

function goHome() {
  // Leave fullscreen first if active — exiting fullscreen mid-route is jarring.
  if (isFullscreen()) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }
  setNoteView(false);
  resetPapers();
  setStatus("");
  // Refresh the dashboard so any save/delete that happened while reading is
  // reflected immediately when the user lands back on the home page. The
  // input fields now live inside the (closed) composer modal, so focusing
  // them would be confusing — instead, leave focus on the body so keyboard
  // users land on the composer card on their next Tab.
  loadDashboard();
}

/* Browser back / forward: reflect the same view change without re-pushing. */
window.addEventListener("popstate", (e) => {
  const v = e.state?.view;
  if (v === "note" && !viewingNote) {
    setNoteView(true, { pushHistory: false });
  } else if (v !== "note" && viewingNote) {
    setNoteView(false, { pushHistory: false });
    resetPapers();
    setStatus("");
  }
});

function pageList() {
  return [...papersEl.querySelectorAll(".paper")].filter(
    (p) => !p.dataset.placeholder
  );
}

let flipping = false;
const FLIP_MS = 850;

function goToPage(idx) {
  const pages = pageList();
  if (!pages.length) return;
  const newIdx = Math.max(0, Math.min(pages.length - 1, idx));
  if (newIdx === currentPage && bookMode) return;

  if (!bookMode) {
    currentPage = newIdx;
    pages.forEach((p, i) => p.classList.toggle("active", i === currentPage));
    updatePageIndicator();
    pages[currentPage]?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (flipping) return; // ignore rapid double-clicks mid-flip

  const oldIdx = currentPage;
  const oldPage = pages[oldIdx];
  const newPage = pages[newIdx];
  const direction = newIdx > oldIdx ? "next" : "prev";

  flipping = true;
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  // grow/shrink container to fit incoming page
  papersEl.style.height = newPage.offsetHeight + "px";

  if (direction === "next") {
    // new page sits underneath at lower z-index, becomes immediately visible
    newPage.classList.add("active");
    // outgoing page rotates from 0 to -180 around its left edge → backface hides it past 90°
    oldPage.classList.add("flip-out");
    setTimeout(() => {
      oldPage.classList.remove("active", "flip-out");
      flipping = false;
      currentPage = newIdx;
      updatePageIndicator();
    }, FLIP_MS);
  } else {
    // incoming page starts at -180 (back to viewer = invisible) and rotates to 0
    newPage.classList.add("flip-in");
    setTimeout(() => {
      oldPage.classList.remove("active");
      newPage.classList.remove("flip-in");
      newPage.classList.add("active");
      flipping = false;
      currentPage = newIdx;
      updatePageIndicator();
    }, FLIP_MS);
  }
}

function updatePageIndicator() {
  const pages = pageList();
  if (!pages.length) {
    pageIndicator.textContent = "0 / 0";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    syncFsFabPage();
    return;
  }
  if (currentPage >= pages.length) currentPage = pages.length - 1;
  pageIndicator.textContent = `${currentPage + 1} / ${pages.length}`;
  prevBtn.disabled = currentPage <= 0;
  nextBtn.disabled = currentPage >= pages.length - 1;
  syncFsFabPage();
  // refresh active highlight in the jump menu (cheap, only touches ~N nodes)
  if (jumpMenuEl && !jumpMenuEl.hidden) {
    jumpMenuEl.querySelectorAll(".jump-item").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.idx) === currentPage);
    });
  }
}

function renumberPages() {
  const pages = pageList();
  pages.forEach((p, i) => {
    let tag = p.querySelector(".page-num");
    if (!tag) {
      tag = document.createElement("div");
      tag.className = "page-num";
      p.appendChild(tag);
    }
    tag.textContent = `— ${i + 1} —`;
    if (bookMode && !flipping) p.classList.toggle("active", i === currentPage);
  });
  updatePageIndicator();
  if (bookMode) syncBookHeight();
}

/* ---------------- per-paper delete ---------------- */

function attachPaperActions(paper, label) {
  if (label) paper.dataset.sourceLabel = label;
  const actions = document.createElement("div");
  actions.className = "paper-actions";
  actions.innerHTML = `
    <button type="button" class="paper-delete-btn" title="Delete this page" aria-label="Delete this page">
      <svg class="icon"><use href="#icon-trash"/></svg>
    </button>
  `;
  paper.appendChild(actions);
}

papersEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".paper-delete-btn");
  if (!btn) return;
  const paper = btn.closest(".paper");
  if (!paper) return;
  const sourceId = paper.dataset.sourceId;
  if (!sourceId) return;
  const label = paper.dataset.sourceLabel || "this page";
  const ok = await showConfirm({
    title: "Remove this page?",
    message: `“${label}” will be removed from this reading session. (It's not deleted from your saved notes if you've saved them.)`,
    okLabel: "Remove",
    destructive: true,
  });
  if (!ok) return;
  deletePaperGroup(sourceId);
});

function deletePaperGroup(sourceId) {
  // remove every paper in this source-group (a single source may have been
  // split into multiple A4 sheets by the paginator)
  const groupPapers = [
    ...papersEl.querySelectorAll(`.paper[data-source-id="${CSS.escape(sourceId)}"]`),
  ];
  if (!groupPapers.length) return;

  const sessionEntry = currentSession.papers.find(
    (p) => p.sourceId === sourceId
  );
  const sourceUrl = sessionEntry?.sourceUrl;

  for (const p of groupPapers) p.remove();
  currentSession.papers = currentSession.papers.filter(
    (p) => p.sourceId !== sourceId
  );

  // remove the matching TOC row, if any
  if (sourceUrl) {
    const tocLi = papersEl.querySelector(
      `#toc-paper #toc-list li[data-url="${CSS.escape(sourceUrl)}"]`
    );
    if (tocLi) tocLi.remove();
  }

  // if we deleted everything, drop back to the empty placeholder state
  const remaining = pageList();
  if (!remaining.length) {
    resetPapers();
    setStatus("");
    return;
  }

  if (currentPage >= remaining.length) currentPage = remaining.length - 1;
  if (currentPage < 0) currentPage = 0;
  if (bookMode) {
    remaining.forEach((p, i) =>
      p.classList.toggle("active", i === currentPage)
    );
  }
  renumberPages();
  if (bookMode) syncBookHeight();
}

/* ---------------- multi-paper rendering ---------------- */

let paperCounter = 0;
// session = the notes currently shown on screen, used by Save and PDF export
let currentSession = { topic: null, sourceUrl: null, folder: null, papers: [] };

function resetSession() {
  currentSession = { topic: null, sourceUrl: null, folder: null, papers: [] };
}

function resetPapers() {
  paperCounter = 0;
  currentPage = 0;
  resetSession();
  papersEl.innerHTML = `
    <div class="paper" data-placeholder="1">
      <div class="paper-margin"></div>
      <div class="notes"><p class="placeholder">your handwritten notes will appear here…</p></div>
    </div>`;
  paperWrap.classList.add("empty");
  readerBar.style.display = "none";
  hideProgress();
  updatePageIndicator();
  hideJumpMenu();
}

function setDownloadEnabled(enabled) {
  dlPdfBtn.disabled = !enabled;
  dlPngBtn.disabled = !enabled;
  if (printBtn) printBtn.disabled = !enabled;
  if (saveBtn) saveBtn.disabled = !enabled;
  if (enabled) {
    setNoteView(true);
    rebuildJumpMenu();
  }
}

function showError(msg) {
  papersEl.innerHTML = `
    <div class="paper">
      <div class="paper-margin"></div>
      <div class="notes"><p class="placeholder" style="color:#c0392b">⚠ ${escapeHtml(
        msg
      )}</p></div>
    </div>`;
  paperWrap.classList.add("empty");
}

function buildTocPaper() {
  const paper = document.createElement("div");
  paper.className = "paper toc";
  paper.id = "toc-paper";
  paper.innerHTML = `
    <div class="paper-margin"></div>
    <h2>Table of Contents</h2>
    <div class="toc-sub">pages discovered while crawling</div>
    <ol id="toc-list"></ol>
  `;
  const list = paper.querySelector("#toc-list");
  const itemsByUrl = new Map();

  return {
    element: paper,
    addPending(url, title) {
      if (itemsByUrl.has(url)) return;
      const li = document.createElement("li");
      li.className = "pending";
      li.dataset.url = url;
      li.textContent = title || url;
      list.appendChild(li);
      itemsByUrl.set(url, li);
    },
    markDone(url, title, anchorId) {
      let li = itemsByUrl.get(url);
      if (!li) {
        li = document.createElement("li");
        li.dataset.url = url;
        list.appendChild(li);
        itemsByUrl.set(url, li);
      }
      li.classList.remove("pending");
      const a = document.createElement("a");
      a.href = `#${anchorId}`;
      a.textContent = title || url;
      a.addEventListener("click", (e) => {
        const pages = pageList();
        const target = pages.findIndex((p) => p.id === anchorId);
        if (target >= 0) {
          e.preventDefault();
          goToPage(target);
          if (!bookMode) {
            pages[target].scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      });
      li.innerHTML = "";
      li.appendChild(a);
    },
    markError(url, msg) {
      const li = itemsByUrl.get(url);
      if (!li) return;
      li.classList.remove("pending");
      li.innerHTML = `<span style="color:#c0392b">${escapeHtml(
        li.textContent
      )} — ${escapeHtml(msg)}</span>`;
    },
  };
}

function appendNotesPaper(notes, sourceUrl, sourceTitle) {
  // remove placeholder once first real paper lands
  const placeholder = papersEl.querySelector('[data-placeholder="1"]');
  if (placeholder) placeholder.remove();
  paperWrap.classList.remove("empty");

  paperCounter++;
  const id = `note-${paperCounter}`;
  const paper = document.createElement("div");
  paper.className = "paper";
  paper.id = id;
  paper.dataset.sourceId = id;
  paper.innerHTML = `<div class="paper-margin"></div><div class="notes"></div>`;
  attachPaperActions(paper, sourceTitle || notes?.title);
  const notesEl = paper.querySelector(".notes");

  renderNotesInto(notesEl, notes, sourceUrl, sourceTitle);
  papersEl.appendChild(paper);

  // After layout: draw the sketchy shapes, then split into multiple A4 sheets
  // if the content is taller than one A4 page (so nothing gets cut mid-bullet).
  requestAnimationFrame(() => {
    drawHandDrawnShapes(notesEl);
    drawFlowConnectors(notesEl);
    paginateOversizedPaper(paper);
    // Pagination may have moved elements to new papers — re-run drawing on
    // every paper so any element that ended up shape-less still gets a shape.
    // drawHandDrawnShapes is idempotent (skips elements that already have one).
    requestAnimationFrame(() => {
      papersEl
        .querySelectorAll(".paper:not([data-placeholder]) .notes")
        .forEach((n) => {
          drawHandDrawnShapes(n);
          drawFlowConnectors(n);
        });
    });
    renumberPages();
    if (bookMode) syncBookHeight();
  });
  return id;
}

/* ---------------- A4 pagination ---------------- */
const MM_TO_PX = 96 / 25.4;
const A4_HEIGHT_PX = 297 * MM_TO_PX;

// If a paper is taller than A4, split it at the last section/bullet/box that
// fits, moving the overflow into a new sibling paper. Recursively continues
// so a 4-A4-tall note ends up as 4 sheets, with no element split mid-line.
function paginateOversizedPaper(paper, depth = 0) {
  if (depth > 12) return; // sanity guard
  // small tolerance — A4_HEIGHT_PX rounds to ~1123.6
  if (paper.offsetHeight <= A4_HEIGHT_PX + 6) return;

  const notesEl = paper.querySelector(".notes");
  if (!notesEl) return;
  const children = [...notesEl.children];
  if (children.length < 2) return; // can't split a single element

  const paperPadBottom =
    parseFloat(getComputedStyle(paper).paddingBottom) || 0;
  const usableBottom = A4_HEIGHT_PX - paperPadBottom;

  // Walk top-level children, find the last one whose bottom edge fits.
  // offsetTop on each child is relative to its offsetParent (the paper),
  // since .notes has position: relative.
  let lastFittingIndex = -1;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const top = child.offsetTop + (notesEl.offsetTop || 0);
    const bottom = top + child.offsetHeight;
    if (bottom <= usableBottom) {
      lastFittingIndex = i;
    } else {
      break;
    }
  }

  // If even the first element overflows, accept the overflow (single oversized
  // section) — splitting inside a section is more aggressive than we need now.
  if (lastFittingIndex < 0) return;
  if (lastFittingIndex >= children.length - 1) return;

  // Avoid widow: if the last fitting element is a heading with no body below,
  // push it to the next sheet so the heading stays with its bullets.
  const lastFitting = children[lastFittingIndex];
  if (
    lastFitting.tagName === "H2" ||
    lastFitting.classList.contains("heading") ||
    (lastFitting.tagName === "SECTION" &&
      lastFitting.querySelector("h2.heading") &&
      !lastFitting.querySelector("ul.bullets, .callout"))
  ) {
    // demote this index by 1 so the heading goes to next paper
    if (lastFittingIndex > 0) lastFittingIndex -= 1;
    else return; // can't split sensibly
  }

  const overflow = children.slice(lastFittingIndex + 1);
  if (!overflow.length) return;

  // Build a new paper for the overflow content
  paperCounter++;
  const newId = `note-${paperCounter}`;
  const newPaper = document.createElement("div");
  newPaper.className = "paper";
  newPaper.id = newId;
  newPaper.dataset.sourceId = paper.dataset.sourceId || newId;
  newPaper.innerHTML = `<div class="paper-margin"></div><div class="notes"></div>`;
  attachPaperActions(newPaper, paper.dataset.sourceLabel || "");
  const newNotes = newPaper.querySelector(".notes");

  for (const el of overflow) newNotes.appendChild(el);

  paper.parentNode.insertBefore(newPaper, paper.nextSibling);

  // Recurse — the new paper might also overflow.
  paginateOversizedPaper(newPaper, depth + 1);
}

function renderNotesInto(notesEl, notes, sourceUrl, sourceTitle) {
  notesEl.innerHTML = "";
  const frag = document.createDocumentFragment();

  const h1 = el("h1", "title", notes.title || sourceTitle || "Notes");
  frag.appendChild(h1);

  if (notes.subtitle) frag.appendChild(el("p", "subtitle", notes.subtitle));

  if (sourceUrl) {
    const src = el("div", "source");
    src.innerHTML = `from <a href="${escapeAttr(
      sourceUrl
    )}" target="_blank" rel="noopener">${escapeHtml(
      sourceTitle || sourceUrl
    )}</a>`;
    frag.appendChild(src);
  }

  for (const sec of notes.sections || []) {
    const section = el("section", "note-section");

    const heading = el("h2", "heading", sec.heading || "");
    section.appendChild(heading);

    if (Array.isArray(sec.bullets) && sec.bullets.length) {
      const ul = el("ul", "bullets");
      for (const b of sec.bullets) {
        const li = document.createElement("li");
        li.innerHTML = highlightInline(b);
        ul.appendChild(li);
      }
      section.appendChild(ul);
    }

    if (Array.isArray(sec.codeSnippets) && sec.codeSnippets.length) {
      for (const snip of sec.codeSnippets) {
        const block = renderCodeSnippet(snip);
        if (block) section.appendChild(block);
      }
    }

    if (sec.callout) {
      const co = el("div", "callout");
      co.innerHTML = `<span class="callout-label">★ Note:</span>${escapeHtml(
        sec.callout
      )}`;
      section.appendChild(co);
    }

    if (sec.doodle) {
      const dood = doodleSvg(sec.doodle);
      if (dood) {
        dood.classList.add("doodle");
        section.appendChild(dood);
      }
    }

    frag.appendChild(section);
  }

  if (Array.isArray(notes.keyTerms) && notes.keyTerms.length) {
    const terms = el("div", "terms");
    terms.appendChild(el("h3", "", "Key terms ✦"));
    for (const t of notes.keyTerms) {
      const row = el("div", "term-row");
      row.innerHTML = `<span class="term">${escapeHtml(
        t.term || ""
      )}</span><span class="meaning">— ${escapeHtml(t.meaning || "")}</span>`;
      terms.appendChild(row);
    }
    frag.appendChild(terms);
  }

  if (notes.realExample && (notes.realExample.usedBy || notes.realExample.scenario)) {
    frag.appendChild(renderRealExample(notes.realExample));
  }

  if (notes.flow && notes.flow.root) {
    const flowEl = renderFlowSummary(notes.flow);
    if (flowEl) frag.appendChild(flowEl);
  }

  if (notes.summary) {
    const s = el("div", "summary");
    s.innerHTML = `<span class="label">TL;DR →</span>${escapeHtml(notes.summary)}`;
    frag.appendChild(s);
  }

  notesEl.appendChild(frag);
}

function drawHandDrawnShapes(scope) {
  scope.querySelectorAll("h2.heading").forEach((h, i) => {
    if (h.querySelector("svg.underline")) return;
    const w = h.offsetWidth + 12;
    const svg = svgEl("svg", { class: "underline", viewBox: `0 0 ${w} 14` });
    svg.setAttribute("width", w);
    svg.setAttribute("height", 14);
    const rc = rough.svg(svg);
    const node = rc.curve(jitterCurve(w, 14, i), {
      stroke: "#d63384",
      strokeWidth: 2.4,
      roughness: 1.6,
      bowing: 2,
    });
    svg.appendChild(node);
    h.appendChild(svg);
  });

  scope.querySelectorAll(".callout, .terms, .summary, .real-example, .flow-summary").forEach((box, i) => {
    if (box.querySelector(":scope > svg.box")) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    if (w < 10 || h < 10) return;
    const svg = svgEl("svg", {
      class: "box",
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: "none",
    });
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    const rc = rough.svg(svg);
    const stroke = box.classList.contains("callout")
      ? "#d63384"
      : box.classList.contains("terms")
      ? "#1e88e5"
      : box.classList.contains("real-example")
      ? "#16a34a"
      : box.classList.contains("flow-summary")
      ? "#d97706"
      : "#1f2440";
    const fill = box.classList.contains("callout")
      ? "rgba(251,191,36,0.18)"
      : box.classList.contains("terms")
      ? "rgba(30,136,229,0.06)"
      : box.classList.contains("real-example")
      ? "rgba(22,163,74,0.05)"
      : box.classList.contains("flow-summary")
      ? "rgba(217,119,6,0.05)"
      : "rgba(214,51,132,0.05)";
    const node = rc.rectangle(4, 4, w - 8, h - 8, {
      stroke,
      strokeWidth: 2,
      roughness: 2.2,
      bowing: 2.5,
      fill,
      fillStyle: "hachure",
      hachureGap: 16,
      hachureAngle: 60 + i * 7,
    });
    svg.appendChild(node);
    box.insertBefore(svg, box.firstChild);
  });
}

function jitterCurve(w, h, seed) {
  const pts = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const x = (w * i) / steps;
    const y = 8 + Math.sin(i * 1.3 + seed) * 2.5;
    pts.push([x, y]);
  }
  return pts;
}

/* ---------------- doodles ---------------- */

function doodleSvg(kind) {
  const svg = svgEl("svg", { viewBox: "0 0 60 60" });
  svg.setAttribute("width", 60);
  svg.setAttribute("height", 60);
  const rc = rough.svg(svg);
  const opts = (color) => ({
    stroke: color,
    strokeWidth: 2,
    roughness: 1.8,
    bowing: 2,
  });

  switch (kind) {
    case "lightbulb": {
      svg.appendChild(rc.circle(30, 24, 26, opts("#fbbf24")));
      svg.appendChild(
        rc.rectangle(22, 38, 16, 8, {
          ...opts("#1f2440"),
          fill: "#fbbf24",
          fillStyle: "solid",
        })
      );
      svg.appendChild(rc.line(26, 50, 34, 50, opts("#1f2440")));
      break;
    }
    case "star": {
      const pts = starPoints(30, 30, 14, 6, 5);
      svg.appendChild(
        rc.polygon(pts, {
          ...opts("#d63384"),
          fill: "rgba(251,191,36,0.5)",
          fillStyle: "hachure",
        })
      );
      break;
    }
    case "warning": {
      svg.appendChild(
        rc.polygon(
          [
            [30, 6],
            [54, 50],
            [6, 50],
          ],
          {
            ...opts("#d97706"),
            fill: "rgba(251,191,36,0.4)",
            fillStyle: "hachure",
          }
        )
      );
      svg.appendChild(rc.line(30, 22, 30, 38, opts("#1f2440")));
      svg.appendChild(rc.circle(30, 44, 3, opts("#1f2440")));
      break;
    }
    case "arrow": {
      svg.appendChild(rc.line(8, 30, 50, 30, opts("#1e88e5")));
      svg.appendChild(rc.line(50, 30, 40, 22, opts("#1e88e5")));
      svg.appendChild(rc.line(50, 30, 40, 38, opts("#1e88e5")));
      break;
    }
    case "heart": {
      const path =
        "M30,50 C10,36 6,22 18,16 C26,12 30,20 30,20 C30,20 34,12 42,16 C54,22 50,36 30,50 Z";
      svg.appendChild(
        rc.path(path, {
          ...opts("#d63384"),
          fill: "rgba(214,51,132,0.3)",
          fillStyle: "hachure",
        })
      );
      break;
    }
    case "checkmark": {
      svg.appendChild(rc.circle(30, 30, 44, opts("#16a34a")));
      svg.appendChild(rc.line(16, 30, 26, 40, opts("#16a34a")));
      svg.appendChild(rc.line(26, 40, 44, 20, opts("#16a34a")));
      break;
    }
    case "question": {
      svg.appendChild(rc.circle(30, 30, 44, opts("#1e88e5")));
      const t = svgEl("text", {
        x: 30,
        y: 38,
        "text-anchor": "middle",
        "font-family": "Caveat, cursive",
        "font-size": 30,
        "font-weight": 700,
        fill: "#1e88e5",
      });
      t.textContent = "?";
      svg.appendChild(t);
      break;
    }
    default:
      return null;
  }
  return svg;
}

function starPoints(cx, cy, outerR, innerR, points) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / points) * i - Math.PI / 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/* ---------------- helpers ---------------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  return escapeHtml(s);
}
function highlightInline(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, '<span class="highlight">$1</span>');
  out = out.replace(
    /(?<!\*)\*([^*\n]+?)\*(?!\*)/g,
    '<span class="highlight">$1</span>'
  );
  // backtick-wrapped tokens become inline code pills (monospace, dark pill)
  out = out.replace(/`([^`]+)`/g, '<code class="code-inline">$1</code>');
  return out;
}

/* ---------------- real-world example rendering ---------------- */
function renderRealExample(ex) {
  const wrap = el("div", "real-example");
  wrap.appendChild(el("h3", "", "In the wild ⚡"));

  if (ex.usedBy) {
    const used = el("div", "real-used-by");
    used.innerHTML = `<span class="real-label">Used by</span><span class="real-name">${escapeHtml(
      ex.usedBy
    )}</span>`;
    wrap.appendChild(used);
  }

  if (ex.scenario) {
    const scen = el("p", "real-scenario");
    scen.innerHTML = highlightInline(ex.scenario);
    wrap.appendChild(scen);
  }

  if (ex.code) {
    const block = renderCodeSnippet({
      code: ex.code,
      lang: ex.lang || "plaintext",
      caption: ex.caption || "",
    });
    if (block) {
      block.classList.add("real-code");
      wrap.appendChild(block);
    }
  }

  return wrap;
}

/* ---------------- flow / hierarchy summary ---------------- */
const FLOW_KIND_BULLETS = {
  concept: "●",
  method: "▸",
  event: "⚡",
  option: "◆",
  step: "➤",
};
const FLOW_VALID_KINDS = new Set(Object.keys(FLOW_KIND_BULLETS));

function renderFlowSummary(flow) {
  if (!flow || !flow.root || !flow.root.label) return null;
  const wrap = el("div", "flow-summary");
  wrap.appendChild(el("h3", "", flow.title || "How it all fits together ↳"));

  const tree = el("ul", "flow-tree");
  tree.appendChild(buildFlowNode(flow.root));
  wrap.appendChild(tree);

  return wrap;
}

function buildFlowNode(node) {
  const li = el("li", "flow-node");
  const kindRaw = String(node.kind || "concept").toLowerCase();
  const kind = FLOW_VALID_KINDS.has(kindRaw) ? kindRaw : "concept";
  li.dataset.kind = kind;

  const row = el("div", "flow-row");
  const bullet = FLOW_KIND_BULLETS[kind] || "●";
  let html = `<span class="flow-kind">${escapeHtml(bullet)}</span>` +
    `<span class="flow-label">${escapeHtml(node.label || "")}</span>`;
  if (node.note) {
    html += `<span class="flow-note">— ${escapeHtml(node.note)}</span>`;
  }
  row.innerHTML = html;
  li.appendChild(row);

  if (Array.isArray(node.children) && node.children.length) {
    const sub = el("ul", "flow-tree");
    for (const c of node.children) sub.appendChild(buildFlowNode(c));
    li.appendChild(sub);
  }
  return li;
}

function drawFlowConnectors(scope) {
  if (!window.rough) return;
  scope.querySelectorAll(".flow-tree .flow-tree").forEach((sub) => {
    if (sub.querySelector(":scope > svg.flow-connector")) return;
    const w = sub.offsetWidth;
    const h = sub.offsetHeight;
    if (w < 12 || h < 12) return;

    const rows = [...sub.querySelectorAll(":scope > .flow-node > .flow-row")];
    if (!rows.length) return;

    const svg = svgEl("svg", {
      class: "flow-connector",
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: "none",
    });
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);

    const rc = rough.svg(svg);
    const opts = {
      stroke: "#d97706",
      strokeWidth: 1.6,
      roughness: 1.6,
      bowing: 1.6,
    };

    const lastRow = rows[rows.length - 1];
    const spineEndY = lastRow.offsetTop + lastRow.offsetHeight / 2;
    svg.appendChild(rc.line(10, 0, 10, spineEndY, opts));

    for (const row of rows) {
      const y = row.offsetTop + row.offsetHeight / 2;
      svg.appendChild(rc.line(10, y, 28, y, opts));
    }

    sub.insertBefore(svg, sub.firstChild);
  });
}

/* ---------------- code snippet rendering ---------------- */

// The model occasionally returns multi-statement code without real newlines
// (single-line blob). Reinsert line breaks at obvious statement boundaries so
// it at least RENDERS as multi-line — better than a horizontally-scrolling wall.
function reflowSingleLineCode(code, lang) {
  if (!code || code.includes("\n")) return code;
  if (code.length < 60) return code; // genuinely short one-liner — leave it
  let s = code;
  if (/^(javascript|typescript|tsx|jsx|js|ts|json|java|c|cpp|c\+\+|go|rust|css|scss|swift|kotlin|php|dart)/i.test(lang || "")) {
    // statement separators / brace boundaries
    s = s.replace(/;\s*(?!$)/g, ";\n");
    s = s.replace(/\{\s*(?!$)/g, "{\n");
    s = s.replace(/\s*\}/g, "\n}");
    s = s.replace(/,\s*(?=(?:[a-zA-Z_$"'`])(?:[^()]*[)\]]))?/g, (m, p1, off, str) => m); // no-op safety
  } else if (/^(python|py)/i.test(lang || "")) {
    s = s.replace(/:\s+(?=\S)/g, ":\n    ");
  } else if (/^(bash|sh|shell|zsh)/i.test(lang || "")) {
    s = s.replace(/\s*&&\s*/g, " &&\n");
    s = s.replace(/;\s*(?!$)/g, "\n");
  } else if (/^(html|xml)/i.test(lang || "")) {
    s = s.replace(/>\s*</g, ">\n<");
  }
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function renderCodeSnippet(snip) {
  if (!snip || typeof snip !== "object") return null;
  let code = String(snip.code || "").replace(/\s+$/g, "");
  if (!code) return null;
  const lang = String(snip.lang || "plaintext").toLowerCase().trim() || "plaintext";
  code = reflowSingleLineCode(code, lang);

  const wrap = document.createElement("div");
  wrap.className = "code-snippet";

  const block = document.createElement("div");
  block.className = "code-block";
  block.dataset.lang = lang;

  const langTag = document.createElement("span");
  langTag.className = "code-lang";
  langTag.textContent = lang === "plaintext" ? "code" : lang;
  block.appendChild(langTag);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.className = `language-${lang}`;
  codeEl.textContent = code;
  pre.appendChild(codeEl);
  block.appendChild(pre);
  wrap.appendChild(block);

  if (snip.caption) {
    const cap = document.createElement("div");
    cap.className = "code-caption";
    cap.textContent = snip.caption;
    wrap.appendChild(cap);
  }

  // syntax-highlight if hljs is loaded
  if (window.hljs) {
    try {
      window.hljs.highlightElement(codeEl);
    } catch (e) {
      console.warn("hljs highlight failed for", lang, e);
    }
    // Make sure the `hljs` class is set so our base color rule applies even
    // when the language wasn't recognised (highlightElement skips silently).
    codeEl.classList.add("hljs");
  } else {
    console.warn("hljs not loaded — code will render without syntax colors");
    codeEl.classList.add("hljs");
  }
  return wrap;
}

/* ---------------- save & library ---------------- */
saveBtn?.addEventListener("click", async () => {
  if (!currentSession.papers.length) {
    return setStatus("nothing to save yet.");
  }
  const fallback =
    currentSession.topic ||
    currentSession.papers[0]?.notes?.title ||
    currentSession.papers[0]?.sourceTitle ||
    "Untitled";
  const name = await showPrompt({
    title: "Save notes",
    message: "What should we call these notes?",
    placeholder: "Name…",
    defaultValue: fallback,
    okLabel: "Continue",
  });
  if (name == null) return; // user cancelled

  // If the user already chose a folder when they kicked off the conversion
  // (via the page-picker modal), reuse it without asking again. Otherwise
  // pop the styled folder picker so they can pick now.
  let folder = null;
  if (currentSession.folder) {
    folder = currentSession.folder;
  } else {
    try {
      const fr = await fetch("/api/folders");
      const fd = await fr.json();
      const folders = Array.isArray(fd?.folders) ? fd.folders : [];
      const picked = await showFolderPicker({
        title: "Save where?",
        message: "Pick a folder, or save without one. You can change this later.",
        folders,
        currentFolder: null,
      });
      if (picked === undefined) return; // user cancelled
      folder = picked; // null = uncategorized; string = folder name
    } catch {
      folder = null; // folders endpoint unreachable — save uncategorized
    }
  }

  setStatus("saving…");
  try {
    const res = await fetch("/api/save-notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || fallback,
        topic: currentSession.topic,
        sourceUrl: currentSession.sourceUrl,
        folder,
        papers: currentSession.papers,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "save failed");
    const where = data.folder
      ? ` in folder “${data.folder}”`
      : "";
    setStatus(`saved “${data.name}”${where} ✓`);
    loadDashboard();
  } catch (err) {
    console.error(err);
    setStatus(`couldn't save: ${err.message}`);
  }
});

/* Thin wrapper around showFolderPicker — kept as a name in case other code
   imports it; the styled picker is now the single source of truth. */
async function pickFolderForSave(folders) {
  return showFolderPicker({ folders, title: "Choose a folder" });
}

openLibraryBtn?.addEventListener("click", openLibrary);
closeLibraryBtn?.addEventListener("click", closeLibrary);
libraryModal?.addEventListener("click", (e) => {
  if (e.target === libraryModal) closeLibrary();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && libraryModal.style.display !== "none") closeLibrary();
});

let libraryItems = [];
let libraryFolders = [];        // server-known folder names
let activeFolder = null;        // null = "All"; "" = "Uncategorized"; otherwise folder name
const librarySidebarEl = $("#librarySidebar");

async function openLibrary() {
  libraryModal.style.display = "flex";
  libraryListEl.innerHTML = `<div class="library-empty">loading…</div>`;
  if (librarySearchEl) librarySearchEl.value = "";
  if (libraryCountEl) libraryCountEl.textContent = "";
  if (librarySidebarEl) librarySidebarEl.innerHTML = "";
  try {
    const res = await fetch("/api/list-notes");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed to list notes");
    if (libraryFolderEl && (data.folderPath || data.folder))
      libraryFolderEl.textContent = data.folderPath || data.folder;
    libraryItems = data.items || [];
    libraryFolders = Array.isArray(data.folders) ? data.folders : [];
    renderSidebar();
    renderFilteredList();
    setTimeout(() => librarySearchEl?.focus(), 80);
  } catch (err) {
    console.error(err);
    libraryListEl.innerHTML = `<div class="library-empty" style="color:#c0392b">⚠ ${escapeHtml(err.message)}</div>`;
  }
}
function closeLibrary() {
  libraryModal.style.display = "none";
  closeMovePopover();
}

/* Finder-style sidebar:
     ── LIBRARY ──
        📚 All notes
        📂 Uncategorized        (only when non-empty)
     ── FOLDERS ──
        📁 Folder A    [×]
        📁 Folder B    [×]
        + New folder
   activeFolder values:
     null  → "All notes"
     ""    → "Uncategorized"
     else  → that folder. */
function renderSidebar() {
  if (!librarySidebarEl) return;
  const counts = countItemsByFolder();
  const totalAll = libraryItems.length;
  const uncatCount = counts.get("") || 0;

  librarySidebarEl.innerHTML = "";

  // Library section
  const libSection = document.createElement("div");
  libSection.className = "sidebar-section";
  libSection.innerHTML = `<div class="sidebar-label">Library</div>`;
  libSection.appendChild(makeSidebarItem({
    key: null,
    label: "All notes",
    count: totalAll,
    icon: "book-open",
  }));
  if (uncatCount > 0 || activeFolder === "") {
    libSection.appendChild(makeSidebarItem({
      key: "",
      label: "Uncategorized",
      count: uncatCount,
      icon: "folder",
    }));
  }
  librarySidebarEl.appendChild(libSection);

  // Folders section (always show heading; add button always visible)
  const folSection = document.createElement("div");
  folSection.className = "sidebar-section";
  folSection.innerHTML = `<div class="sidebar-label">Folders</div>`;
  for (const f of libraryFolders) {
    folSection.appendChild(makeSidebarItem({
      key: f,
      label: f,
      count: counts.get(f) || 0,
      icon: "folder",
      removable: true,
    }));
  }
  librarySidebarEl.appendChild(folSection);

  // "+ New folder" — sits at the bottom (margin-top: auto pushes it there)
  const add = document.createElement("button");
  add.type = "button";
  add.className = "sidebar-add";
  add.innerHTML = `<svg class="icon" style="width:14px;height:14px"><use href="#icon-folder"/></svg><span>New folder</span>`;
  add.addEventListener("click", () => promptNewFolder());
  librarySidebarEl.appendChild(add);
}

function makeSidebarItem({ key, label, count, icon, removable = false }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sidebar-item" + (sameFolder(activeFolder, key) ? " active" : "");
  btn.dataset.folder = key === null ? "__all__" : key;
  btn.innerHTML =
    `<svg class="icon sidebar-icon"><use href="#icon-${icon}"/></svg>` +
    `<span class="sidebar-name">${escapeHtml(label)}</span>` +
    `<span class="sidebar-count">${count}</span>` +
    (removable
      ? `<span class="sidebar-delete" title="Delete folder"><svg><use href="#icon-x"/></svg></span>`
      : "");
  btn.addEventListener("click", (e) => {
    if (e.target.closest(".sidebar-delete")) return; // handled below
    activeFolder = key;
    renderSidebar();
    renderFilteredList();
  });
  if (removable) {
    btn.querySelector(".sidebar-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFolder(key);
    });
  }
  return btn;
}

function sameFolder(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a === b;
}

function countItemsByFolder() {
  const m = new Map();
  for (const it of libraryItems) {
    const k = it.folder || "";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/* Finder-ish "saved when" buckets — uses calendar days, not 24-hour windows,
   so a note saved at 11pm yesterday correctly lands in "Yesterday" instead
   of "Today" when viewed at 8am. */
function dateGroupLabel(iso) {
  if (!iso) return "Older";
  const saved = new Date(iso);
  if (Number.isNaN(saved.getTime())) return "Older";
  const now = new Date();
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const today = startOfDay(now);
  const savedDay = startOfDay(saved);
  const dayDiff = Math.round((today - savedDay) / 86400000);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return "Previous 7 Days";
  if (dayDiff < 30) return "Previous 30 Days";
  if (saved.getFullYear() === now.getFullYear()) {
    return saved.toLocaleString(undefined, { month: "long" });
  }
  return saved.getFullYear().toString();
}

function filterLibraryItems(query) {
  const q = (query || "").trim().toLowerCase();
  return libraryItems.filter((item) => {
    if (activeFolder !== null) {
      const f = item.folder || "";
      if (f !== activeFolder) return false;
    }
    if (!q) return true;
    const hay = [item.name, item.topic, item.sourceUrl, item.filename, item.folder]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function renderFilteredList() {
  const q = librarySearchEl?.value || "";
  renderLibraryList(filterLibraryItems(q), { query: q });
}

librarySearchEl?.addEventListener("input", () => renderFilteredList());

function renderLibraryList(items, { query = "" } = {}) {
  if (libraryCountEl) {
    const filteredCount =
      activeFolder === null
        ? libraryItems.length
        : libraryItems.filter((it) => (it.folder || "") === activeFolder).length;
    if (!libraryItems.length) {
      libraryCountEl.textContent = "";
    } else if (query.trim() || activeFolder !== null) {
      libraryCountEl.textContent = `${items.length} of ${libraryItems.length}`;
    } else {
      libraryCountEl.textContent = `${filteredCount} saved`;
    }
  }
  if (!items.length) {
    if (!libraryItems.length) {
      libraryListEl.innerHTML = `<div class="library-empty">No saved notes yet. Generate some, then click <strong>Save</strong>.</div>`;
    } else if (query.trim()) {
      libraryListEl.innerHTML = `<div class="library-empty">Nothing matches "<strong>${escapeHtml(query)}</strong>".</div>`;
    } else if (activeFolder) {
      libraryListEl.innerHTML = `<div class="library-empty">No notes in <strong>${escapeHtml(activeFolder)}</strong> yet. Click <strong>Move</strong> on any note to put it here.</div>`;
    } else {
      libraryListEl.innerHTML = `<div class="library-empty">All notes are filed in a folder. Pick one in the sidebar to see them.</div>`;
    }
    return;
  }
  libraryListEl.innerHTML = "";
  // Mac Finder-style date grouping. We render a sticky-ish header (Today,
  // Yesterday, Previous 7 Days, …) before the first row in each group. The
  // server already returns items sorted newest-first, so we just walk in
  // order and emit a header whenever the group changes.
  let lastGroup = null;
  for (const item of items) {
    const group = dateGroupLabel(item.savedAt);
    if (group !== lastGroup) {
      const header = document.createElement("div");
      header.className = "library-date-group";
      header.textContent = group;
      libraryListEl.appendChild(header);
      lastGroup = group;
    }
    const row = document.createElement("div");
    row.className = "library-item";
    const dateStr = item.savedAt
      ? new Date(item.savedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "";
    const ctxLabel = item.topic
      ? `topic: ${item.topic}`
      : item.sourceUrl
      ? new URL(item.sourceUrl, location.origin).hostname
      : "";
    const folderChip = item.folder
      ? `<span class="library-folder-chip"><svg class="icon" style="width:11px;height:11px"><use href="#icon-folder"/></svg>${escapeHtml(item.folder)}</span>`
      : "";
    row.innerHTML = `
      <div class="library-item-main">
        <p class="library-item-title">${escapeHtml(item.name || item.filename)}</p>
        <div class="library-item-meta">
          <span>${item.paperCount} page${item.paperCount === 1 ? "" : "s"}</span>
          ${ctxLabel ? `<span class="dot">·</span><span>${escapeHtml(ctxLabel)}</span>` : ""}
          ${dateStr ? `<span class="dot">·</span><span>${escapeHtml(dateStr)}</span>` : ""}
          ${folderChip ? `<span class="dot">·</span>${folderChip}` : ""}
        </div>
      </div>
      <div class="library-actions">
        <button class="ghost move-btn" data-filename="${escapeAttr(item.filename)}" title="Move to a folder">Move</button>
        <button class="ghost load-btn" data-filename="${escapeAttr(item.filename)}">Open</button>
        <button class="ghost delete-btn" data-filename="${escapeAttr(item.filename)}" aria-label="Delete">
          <svg class="icon"><use href="#icon-trash"/></svg>
        </button>
      </div>
    `;
    libraryListEl.appendChild(row);
  }
  libraryListEl.querySelectorAll(".load-btn").forEach((b) =>
    b.addEventListener("click", () => loadSavedNotes(b.dataset.filename))
  );
  libraryListEl.querySelectorAll(".delete-btn").forEach((b) =>
    b.addEventListener("click", () => deleteSavedNotes(b.dataset.filename))
  );
  libraryListEl.querySelectorAll(".move-btn").forEach((b) =>
    b.addEventListener("click", (e) => openMovePopover(b, b.dataset.filename))
  );
}

/* ---------------- folder mutations ---------------- */

async function promptNewFolder() {
  const name = await showPrompt({
    title: "New folder",
    message: "What should we call it?",
    placeholder: "e.g. Work, Study",
    okLabel: "Create",
  });
  if (name == null) return;
  const trimmed = String(name).trim();
  if (!trimmed) return;
  try {
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "create failed");
    libraryFolders = data.folders || libraryFolders;
    activeFolder = data.name; // jump into the new folder
    renderSidebar();
    renderFilteredList();
  } catch (err) {
    await showAlert({
      title: "Couldn't create folder",
      message: err.message,
    });
  }
}

async function deleteFolder(name) {
  if (!name) return;
  const ok = await showConfirm({
    title: `Delete “${name}”?`,
    message:
      `The folder will be removed. The ${countItemsByFolder().get(name) || 0} note${
        (countItemsByFolder().get(name) || 0) === 1 ? "" : "s"
      } inside will become uncategorized — no notes are deleted.`,
    okLabel: "Delete folder",
    destructive: true,
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/folders/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "delete failed");
    libraryFolders = data.folders || [];
    if (activeFolder === name) activeFolder = null;
    // server moved orphans to uncategorized — reflect in our local copy
    libraryItems = libraryItems.map((it) =>
      it.folder === name ? { ...it, folder: null } : it
    );
    renderSidebar();
    renderFilteredList();
  } catch (err) {
    await showAlert({
      title: "Couldn't delete folder",
      message: err.message,
    });
  }
}

async function moveNoteToFolder(filename, folder) {
  try {
    const res = await fetch(
      `/api/notes/${encodeURIComponent(filename)}/folder`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder: folder || "" }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "move failed");
    // local update
    libraryItems = libraryItems.map((it) =>
      it.filename === filename ? { ...it, folder: data.folder || null } : it
    );
    if (data.folder && !libraryFolders.includes(data.folder)) {
      libraryFolders = [...libraryFolders, data.folder].sort((a, b) =>
        a.localeCompare(b)
      );
    }
    renderSidebar();
    renderFilteredList();
  } catch (err) {
    await showAlert({
      title: "Couldn't move note",
      message: err.message,
    });
  }
}

/* ---------------- "Move to folder" — uses the styled folder picker ---------------- */

// Kept for backward compatibility with the old call site name.
function closeMovePopover() {} // intentional no-op now

async function openMovePopover(anchorBtn, filename) {
  const item = libraryItems.find((it) => it.filename === filename);
  const current = item?.folder || null;
  const picked = await showFolderPicker({
    title: `Move "${item?.name || filename}"`,
    message: "Pick a destination folder.",
    folders: libraryFolders,
    currentFolder: current,
  });
  if (picked === undefined) return; // user cancelled
  // If picked is a string for a folder that doesn't exist yet, the server
  // PATCH endpoint will create it on the fly via writeFolderList.
  await moveNoteToFolder(filename, picked || "");
}

async function loadSavedNotes(filename) {
  setStatus("loading…");
  try {
    const res = await fetch(`/api/notes/${encodeURIComponent(filename)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "load failed");
    closeLibrary();
    setBusy(false);
    setDownloadEnabled(false);
    resetPapers();
    currentSession.topic = data.topic || null;
    currentSession.sourceUrl = data.sourceUrl || null;
    if ((data.papers || []).length > 1 && data.topic) {
      const toc = buildTocPaper();
      papersEl.innerHTML = "";
      papersEl.appendChild(toc.element);
      paperWrap.classList.remove("empty");
      for (const p of data.papers) toc.addPending(p.sourceUrl, p.sourceTitle);
      setTimeout(() => {
        for (const p of data.papers) {
          const id = appendNotesPaper(p.notes, p.sourceUrl, p.sourceTitle);
          currentSession.papers.push({ ...p, sourceId: id });
          restorePaperHtmlIfPresent(id, p.notesHtml);
          toc.markDone(
            p.sourceUrl,
            p.notes?.title || p.sourceTitle,
            id
          );
        }
      }, 0);
    } else {
      for (const p of data.papers || []) {
        const id = appendNotesPaper(p.notes, p.sourceUrl, p.sourceTitle);
        currentSession.papers.push({ ...p, sourceId: id });
        restorePaperHtmlIfPresent(id, p.notesHtml);
      }
    }
    setDownloadEnabled(true);
    showReaderBar();
    setStatus(`opened “${data.name}” ✓`);
  } catch (err) {
    console.error(err);
    setStatus(`couldn't open: ${err.message}`);
  }
}

async function deleteSavedNotes(filename) {
  const item = libraryItems.find((it) => it.filename === filename);
  const ok = await showConfirm({
    title: "Delete these notes?",
    message: item?.name
      ? `“${item.name}” will be removed permanently. This can't be undone.`
      : "This can't be undone.",
    okLabel: "Delete",
    destructive: true,
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/notes/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "delete failed");
    libraryItems = libraryItems.filter((it) => it.filename !== filename);
    renderSidebar();
    renderFilteredList();
    loadDashboard();
  } catch (err) {
    console.error(err);
    await showAlert({ title: "Couldn't delete", message: err.message });
  }
}

/* ---------------- home dashboard (Facebook-style notes feed) ----------------
   Replaces the controls form as the primary home-page surface. The composer
   card opens a modal with the input methods; the grid below shows every
   saved note as a clickable card. Folder pills filter the grid; the search
   input narrows by name/topic/source. Both the dashboard and the legacy
   library modal read from the same /api/list-notes endpoint, so saves and
   deletes in either place stay consistent (we re-fetch from both places). */
let dashboardItems = [];
let dashboardFolders = [];
let dashboardActiveFolder = null; // null = "All"; "" = uncategorized; else folder name
let dashboardSearchQuery = "";

function openComposerModal() {
  if (!composerModalEl) return;
  composerModalEl.style.display = "flex";
  setTimeout(() => {
    if (inputMode === "topic") topicInput?.focus();
    else if (inputMode === "youtube") youtubeInput?.focus();
  }, 60);
}
function closeComposerModal() {
  if (!composerModalEl) return;
  composerModalEl.style.display = "none";
}
composerCardEl?.addEventListener("click", openComposerModal);
composerCardEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openComposerModal();
  }
});
closeComposerBtn?.addEventListener("click", closeComposerModal);
composerModalEl?.addEventListener("click", (e) => {
  if (e.target === composerModalEl) closeComposerModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && composerModalEl?.style.display === "flex") {
    closeComposerModal();
  }
});

async function loadDashboard() {
  if (!notesGridEl) return;
  try {
    const res = await fetch("/api/list-notes");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed to list notes");
    dashboardItems = data.items || [];
    dashboardFolders = Array.isArray(data.folders) ? data.folders : [];
    renderDashboardFilters();
    renderDashboardGrid();
  } catch (err) {
    console.error("loadDashboard:", err);
    notesGridEl.innerHTML = "";
    if (dashboardEmptyEl) {
      dashboardEmptyEl.style.display = "";
      dashboardEmptyEl.querySelector("p").textContent =
        `Couldn't load notes: ${err.message}`;
    }
  }
}

function renderDashboardFilters() {
  if (!dashboardFiltersEl) return;
  const counts = new Map();
  for (const it of dashboardItems) {
    const k = it.folder || "";
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const pills = [];
  pills.push({ key: null, label: "All", count: dashboardItems.length });
  if ((counts.get("") || 0) > 0) {
    pills.push({ key: "", label: "Uncategorized", count: counts.get("") });
  }
  for (const f of dashboardFolders) {
    pills.push({ key: f, label: f, count: counts.get(f) || 0 });
  }
  dashboardFiltersEl.innerHTML = "";
  for (const p of pills) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "filter-pill" + (sameFolder(dashboardActiveFolder, p.key) ? " active" : "");
    btn.innerHTML = `${escapeHtml(p.label)}<span class="filter-pill-count">${p.count}</span>`;
    btn.addEventListener("click", () => {
      dashboardActiveFolder = p.key;
      renderDashboardFilters();
      renderDashboardGrid();
    });
    dashboardFiltersEl.appendChild(btn);
  }
}

function noteSourceKind(item) {
  // Best-effort classifier for the badge on each card. Saved notes don't
  // currently persist a sourceKind field, so we infer from sourceUrl/topic.
  if (item.sourceKind) return item.sourceKind;
  if (item.topic) return "topic";
  const url = item.sourceUrl || "";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (url) return "url";
  return "note";
}
const NOTE_KIND_META = {
  topic: { icon: "search", label: "Topic" },
  url: { icon: "link", label: "URL" },
  youtube: { icon: "play", label: "Video" },
  pdf: { icon: "book-open", label: "PDF" },
  note: { icon: "pencil", label: "Note" },
};

function youtubeIdFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    if (/youtube\.com$/i.test(u.hostname)) {
      return u.searchParams.get("v") || u.pathname.split("/").pop() || "";
    }
  } catch {}
  return "";
}

// Lazy preview fetch — one request per visible card, results cached on the
// server so subsequent dashboard renders are instant.
const previewCache = new Map(); // sourceUrl → { image, favicon, hostname }
const previewInFlight = new Map();
async function fetchUrlPreview(sourceUrl) {
  if (previewCache.has(sourceUrl)) return previewCache.get(sourceUrl);
  if (previewInFlight.has(sourceUrl)) return previewInFlight.get(sourceUrl);
  const promise = (async () => {
    try {
      const res = await fetch(`/api/url-preview?url=${encodeURIComponent(sourceUrl)}`);
      const data = await res.json();
      const safe = data && typeof data === "object" ? data : {};
      previewCache.set(sourceUrl, safe);
      return safe;
    } catch {
      const empty = {};
      previewCache.set(sourceUrl, empty);
      return empty;
    } finally {
      previewInFlight.delete(sourceUrl);
    }
  })();
  previewInFlight.set(sourceUrl, promise);
  return promise;
}

let previewObserver = null;
function ensurePreviewObserver() {
  if (previewObserver || typeof IntersectionObserver === "undefined") return previewObserver;
  previewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const hero = entry.target;
        previewObserver.unobserve(hero);
        const sourceUrl = hero.dataset.sourceUrl;
        if (!sourceUrl) continue;
        fetchUrlPreview(sourceUrl).then((data) => {
          if (!data?.image) {
            hero.classList.remove("is-loading");
            return;
          }
          const img = new Image();
          img.onload = () => {
            const existing = hero.querySelector("img");
            if (existing) existing.remove();
            hero.appendChild(img);
            hero.classList.remove("is-loading");
            // Once we have a real image we can drop the kind icon underlay
            // since the picture itself communicates the source.
            const ki = hero.querySelector(".note-card-hero-kind-icon");
            if (ki) ki.remove();
          };
          img.onerror = () => hero.classList.remove("is-loading");
          img.alt = "";
          img.loading = "lazy";
          img.referrerPolicy = "no-referrer";
          img.src = data.image;
          // Attach favicon to the source line if the card has one.
          const card = hero.closest(".note-card");
          const faviconEl = card?.querySelector(".note-card-source-favicon");
          if (faviconEl && data.favicon && faviconEl.tagName === "IMG") {
            faviconEl.src = data.favicon;
            faviconEl.style.display = "";
          }
        });
      }
    },
    { rootMargin: "200px 0px" }
  );
  return previewObserver;
}

function relativeTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function filterDashboardItems() {
  const q = (dashboardSearchQuery || "").trim().toLowerCase();
  return dashboardItems.filter((item) => {
    if (dashboardActiveFolder !== null) {
      const f = item.folder || "";
      if (f !== dashboardActiveFolder) return false;
    }
    if (!q) return true;
    return (
      (item.name || "").toLowerCase().includes(q) ||
      (item.topic || "").toLowerCase().includes(q) ||
      (item.sourceUrl || "").toLowerCase().includes(q)
    );
  });
}

function renderDashboardGrid() {
  if (!notesGridEl) return;
  const items = filterDashboardItems();
  if (dashboardCountEl) {
    dashboardCountEl.textContent = dashboardItems.length
      ? `${items.length} note${items.length === 1 ? "" : "s"}`
      : "";
  }
  notesGridEl.innerHTML = "";
  if (!items.length) {
    if (dashboardEmptyEl) {
      dashboardEmptyEl.style.display = "";
      const p = dashboardEmptyEl.querySelector("p");
      if (!dashboardItems.length) {
        p.innerHTML =
          "Click <strong>Create note</strong> above to convert your first doc, video or PDF.";
      } else if (dashboardSearchQuery.trim()) {
        p.innerHTML = `Nothing matches "<strong>${escapeHtml(dashboardSearchQuery)}</strong>".`;
      } else {
        p.innerHTML = "Nothing in this folder yet.";
      }
    }
    return;
  }
  if (dashboardEmptyEl) dashboardEmptyEl.style.display = "none";

  const observer = ensurePreviewObserver();
  for (const item of items) {
    const kind = noteSourceKind(item);
    const meta = NOTE_KIND_META[kind] || NOTE_KIND_META.note;
    let hostname = "";
    if (item.sourceUrl) {
      try { hostname = new URL(item.sourceUrl, location.origin).hostname; }
      catch { hostname = item.sourceUrl; }
    }
    const sourceLabel = item.topic || hostname;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "note-card";
    card.dataset.filename = item.filename;

    // For YouTube we know the thumbnail URL deterministically — no /api
    // round-trip needed, just slot it in. For other URLs we render the
    // gradient placeholder + observer; the lazy-fetch swaps in the og:image.
    let heroInner = `<svg class="icon note-card-hero-kind-icon"><use href="#icon-${meta.icon}"/></svg>`;
    let heroExtraClass = `note-card-hero-kind-${kind}`;
    let heroDataAttr = "";
    let isLazy = false;
    if (kind === "youtube") {
      const id = youtubeIdFromUrl(item.sourceUrl);
      if (id) {
        heroInner = `<img loading="lazy" referrerpolicy="no-referrer" alt="" src="https://i.ytimg.com/vi/${escapeAttr(id)}/hqdefault.jpg" />`;
        heroExtraClass = "";
      }
    } else if (item.sourceUrl && /^https?:/i.test(item.sourceUrl)) {
      heroDataAttr = ` data-source-url="${escapeAttr(item.sourceUrl)}"`;
      isLazy = true;
    }

    const faviconHtml =
      hostname && (kind === "url" || kind === "youtube")
        ? `<img class="note-card-source-favicon" src="https://www.google.com/s2/favicons?sz=64&domain=${escapeAttr(hostname)}" alt="" referrerpolicy="no-referrer" loading="lazy" />`
        : "";

    card.innerHTML = `
      <div class="note-card-hero ${heroExtraClass}${isLazy ? " is-loading" : ""}"${heroDataAttr}>
        ${heroInner}
        <div class="note-card-head">
          <span class="note-card-kind">
            <svg class="icon"><use href="#icon-${meta.icon}"/></svg>
            <span>${meta.label}</span>
          </span>
          <button type="button" class="note-card-menu" data-action="delete" data-filename="${escapeAttr(item.filename)}" title="Delete this note" aria-label="Delete this note">
            <svg class="icon"><use href="#icon-trash"/></svg>
          </button>
        </div>
      </div>
      <div class="note-card-body">
        <h3 class="note-card-title">${escapeHtml(item.name || item.filename)}</h3>
        ${sourceLabel
          ? `<p class="note-card-source">${faviconHtml}<span class="note-card-source-host">${escapeHtml(sourceLabel)}</span></p>`
          : ""}
        <div class="note-card-foot">
          <span>${item.paperCount} page${item.paperCount === 1 ? "" : "s"}${item.folder ? ` · ${escapeHtml(item.folder)}` : ""}</span>
          <span>${relativeTime(item.savedAt)}</span>
        </div>
      </div>
    `;
    card.addEventListener("click", (e) => {
      // Clicks on the menu (delete) shouldn't open the note.
      if (e.target.closest('[data-action="delete"]')) return;
      loadSavedNotes(item.filename);
    });
    const delBtn = card.querySelector('[data-action="delete"]');
    delBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteSavedNotes(item.filename);
      loadDashboard();
    });
    notesGridEl.appendChild(card);

    if (isLazy) {
      const hero = card.querySelector(".note-card-hero");
      if (observer) observer.observe(hero);
      else fetchUrlPreview(item.sourceUrl).then((data) => {
        // Fallback path when IntersectionObserver isn't available — fetch
        // immediately for everything we have, no observation.
        if (!data?.image) { hero.classList.remove("is-loading"); return; }
        const img = new Image();
        img.onload = () => {
          hero.appendChild(img);
          hero.classList.remove("is-loading");
          hero.querySelector(".note-card-hero-kind-icon")?.remove();
        };
        img.onerror = () => hero.classList.remove("is-loading");
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.src = data.image;
      });
    }
  }
}

dashboardSearchEl?.addEventListener("input", (e) => {
  dashboardSearchQuery = e.target.value || "";
  renderDashboardGrid();
});

// Initial dashboard render — only when the user is on the home page (not
// already viewing a deep-linked note via #note in the URL).
if (history.state?.view !== "note" && location.hash !== "#note") {
  loadDashboard();
}

/* ---------------- "From a writing sample" pipeline ----------------
   Single image of the user's existing handwriting → vision model identifies
   each visible character + its bbox → we crop each bbox → reuse the same
   binarize/trim/trace/assemble pipeline from the grid builder to produce a
   TTF. Whatever characters AREN'T in the sample are simply left out of the
   font; the CSS fallback chain shows them in Caveat instead. */

const sampleEls = {
  drop: $("#sampleDrop"),
  file: $("#sampleFile"),
  previewWrap: $("#samplePreviewWrap"),
  previewImg: $("#samplePreviewImg"),
  bboxes: $("#sampleBboxes"),
  summary: $("#sampleSummary"),
  build: $("#sampleBuild"),
  progress: $("#sampleProgress"),
  progressFill: $("#sampleProgressFill"),
  progressText: $("#sampleProgressText"),
};

let sampleImage = null;       // HTMLImageElement currently loaded
let sampleDataUrl = null;     // base64 data URL we'll send to the server

sampleEls.file?.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (f) handleSampleFile(f);
});
[sampleEls.drop].forEach((el) => {
  if (!el) return;
  ["dragenter", "dragover"].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      el.classList.add("dragging");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      el.classList.remove("dragging");
    })
  );
  el.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleSampleFile(f);
  });
});

async function handleSampleFile(file) {
  if (!file.type.startsWith("image/")) {
    await showAlert({
      title: "Wrong file type",
      message: "Please upload a PNG, JPEG, or WebP image.",
    });
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    await showAlert({
      title: "Image too large",
      message: "Please use an image under 8 MB.",
    });
    return;
  }
  sampleDataUrl = await readFileAsDataUrl(file);
  sampleImage = await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = sampleDataUrl;
  });
  if (sampleEls.previewImg) sampleEls.previewImg.src = sampleDataUrl;
  if (sampleEls.previewWrap) sampleEls.previewWrap.style.display = "";
  if (sampleEls.build) sampleEls.build.style.display = "";
  if (sampleEls.bboxes) sampleEls.bboxes.innerHTML = "";
  if (sampleEls.summary) sampleEls.summary.textContent = "";
}

sampleEls.build?.addEventListener("click", async () => {
  if (!sampleDataUrl || !sampleImage) return;

  sampleEls.build.disabled = true;
  showSampleProgress(5, "checking HandFonted setup…");
  try {
    // First confirm the server-side Python pipeline is installed; fail fast
    // with a friendly message instead of waiting for a 503 under the call.
    const probe = await fetch("/api/handfonted-status").then((r) => r.json());
    if (!probe?.ok) {
      throw new Error(probe?.reason || "HandFonted isn't installed yet.");
    }

    showSampleProgress(
      15,
      "running HandFonted (segment → classify → assemble) — this can take a minute…"
    );

    const res = await fetch("/api/build-handwriting-font", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageDataUrl: sampleDataUrl,
        fontName: "My Handwriting",
        thickness: 100,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    showSampleProgress(85, `received TTF (${(data.bytes / 1024).toFixed(0)} KB) — registering…`);

    if (sampleEls.summary) {
      sampleEls.summary.innerHTML =
        `Built in <strong>${data.elapsedSeconds}s</strong>. ${(data.bytes / 1024).toFixed(0)} KB font generated by HandFonted.`;
    }

    const dataUrl = `data:font/ttf;base64,${data.ttfBase64}`;
    await applyUserFont(dataUrl, "Your handwriting (HandFonted)");
    try {
      localStorage.setItem(
        USER_FONT_STORAGE,
        JSON.stringify({ name: "Your handwriting (HandFonted).ttf", dataUrl })
      );
    } catch (e) {
      console.warn("couldn't persist generated font:", e);
    }
    showSampleProgress(100, "done — your font is live ✓");
    setTimeout(() => {
      if (fontModal) fontModal.style.display = "none";
      sampleEls.progress.style.display = "none";
    }, 1100);
  } catch (err) {
    console.error(err);
    showSampleProgress(0, `failed: ${err?.message || err}`);
  } finally {
    sampleEls.build.disabled = false;
  }
});

function showSampleProgress(pct, text) {
  if (!sampleEls.progress) return;
  sampleEls.progress.style.display = "";
  if (sampleEls.progressFill)
    sampleEls.progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (sampleEls.progressText) sampleEls.progressText.textContent = text || "";
}

/* Render each AI-supplied bbox over the preview image so the user can see
   what the model identified. Uses the displayed-image scaling, not natural
   pixel coords (because the preview is responsive). */
function drawSampleBboxes(chars) {
  const wrap = sampleEls.bboxes;
  const img = sampleEls.previewImg;
  if (!wrap || !img) return;
  const drawAfterLayout = () => {
    const dispW = img.clientWidth;
    const dispH = img.clientHeight;
    const natW = img.naturalWidth || sampleImage.naturalWidth;
    const natH = img.naturalHeight || sampleImage.naturalHeight;
    if (!dispW || !dispH || !natW || !natH) return;
    const sx = dispW / natW;
    const sy = dispH / natH;
    wrap.innerHTML = chars
      .map((c) => {
        const [x1, y1, x2, y2] = c.bbox || [];
        if (![x1, y1, x2, y2].every(Number.isFinite)) return "";
        const left = x1 * sx;
        const top = y1 * sy;
        const w = (x2 - x1) * sx;
        const h = (y2 - y1) * sy;
        const safe = String(c.char || "?")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<div class="sample-bbox" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px"><span class="sample-bbox-label">${safe}</span></div>`;
      })
      .join("");
  };
  // image may not have laid out yet when this is called the first time
  if (img.complete) drawAfterLayout();
  else img.addEventListener("load", drawAfterLayout, { once: true });
  // also redraw on resize so the boxes stay aligned
  if (!drawSampleBboxes._resizeBound) {
    drawSampleBboxes._resizeBound = true;
    window.addEventListener("resize", () => {
      if (sampleEls.previewWrap?.style.display !== "none") drawAfterLayout();
    });
  }
}

/* Crop each AI-located bbox out of the source image, run the same binarize
   → trim → trace pipeline as the grid flow, build glyph descriptors. */
async function extractGlyphsFromSample(img, charSpecs, onProgress) {
  // Render the source image to a canvas once so we can read pixels from it.
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  const fullImg = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);

  const out = [];
  // De-dupe: if the model returns multiple entries for the same character,
  // keep the highest-confidence one.
  const bestByChar = new Map();
  for (const spec of charSpecs) {
    const ch = String(spec.char || "");
    if (ch.length !== 1) continue;
    const existing = bestByChar.get(ch);
    if (!existing || (spec.confidence || 0) > (existing.confidence || 0)) {
      bestByChar.set(ch, spec);
    }
  }
  const unique = [...bestByChar.values()];
  const total = unique.length;

  for (let i = 0; i < unique.length; i++) {
    const spec = unique[i];
    const ch = spec.char;
    const [x1, y1, x2, y2] = spec.bbox || [];
    if (![x1, y1, x2, y2].every(Number.isFinite)) {
      onProgress?.(((i + 1) / total) * 100, `skipped ${ch} (bad bbox)`);
      continue;
    }
    // clamp to image
    const cx = Math.max(0, Math.floor(x1));
    const cy = Math.max(0, Math.floor(y1));
    const cw = Math.min(canvas.width - cx, Math.ceil(x2 - x1));
    const ch_ = Math.min(canvas.height - cy, Math.ceil(y2 - y1));
    if (cw < 6 || ch_ < 6) {
      onProgress?.(((i + 1) / total) * 100, `skipped ${ch} (too small)`);
      continue;
    }
    // re-use the same pipeline as the grid builder
    const bin = binarizeRegion(fullImg, cx, cy, cw, ch_);
    const trimmed = trimToInk(bin);
    if (!trimmed) {
      onProgress?.(((i + 1) / total) * 100, `skipped ${ch} (no ink)`);
      continue;
    }
    const traced = traceGlyph(trimmed);
    if (!traced) {
      onProgress?.(((i + 1) / total) * 100, `skipped ${ch} (no trace)`);
      continue;
    }
    out.push({ char: ch, ...traced });
    onProgress?.(((i + 1) / total) * 100, `traced ${ch} (${i + 1}/${total})`);
    if (i % 6 === 0) await microtask();
  }
  return out;
}

/* ---------------- styled dialog system ----------------
   Replaces window.alert / confirm / prompt with on-brand modals so they
   match the rest of the app's design language (sketchy paper backdrop,
   Caveat title font, soft shadows, consistent buttons) instead of the
   stark default browser dialogs. All return a promise — alert resolves
   to undefined, confirm to true/false, prompt to a string or null. */

const _dialogStack = [];

function showDialog({
  kind = "alert",            // "alert" | "confirm" | "prompt"
  title,
  message = "",
  defaultValue = "",
  placeholder = "",
  okLabel,
  cancelLabel = "Cancel",
  destructive = false,
}) {
  return new Promise((resolve) => {
    const finalOkLabel =
      okLabel || (kind === "alert" ? "OK" : kind === "prompt" ? "Save" : "Confirm");

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop dialog-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");

    const modal = document.createElement("div");
    modal.className = "modal modal-dialog";
    backdrop.appendChild(modal);

    const head = document.createElement("div");
    head.className = "modal-head dialog-head";
    const h = document.createElement("h2");
    h.textContent = title || "";
    head.appendChild(h);
    modal.appendChild(head);

    const body = document.createElement("div");
    body.className = "dialog-body";
    if (message) {
      const p = document.createElement("p");
      p.className = "dialog-message";
      p.textContent = message;
      body.appendChild(p);
    }
    let input = null;
    if (kind === "prompt") {
      input = document.createElement("input");
      input.type = "text";
      input.className = "dialog-input";
      input.value = defaultValue;
      input.placeholder = placeholder;
      input.spellcheck = false;
      input.autocomplete = "off";
      body.appendChild(input);
    }
    modal.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "dialog-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ghost";
    cancelBtn.textContent = cancelLabel;
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = destructive ? "primary danger" : "primary";
    okBtn.textContent = finalOkLabel;
    if (kind !== "alert") footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);
    modal.appendChild(footer);

    document.body.appendChild(backdrop);
    _dialogStack.push(backdrop);

    setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      } else okBtn.focus();
    }, 30);

    const cleanup = () => {
      backdrop.remove();
      const i = _dialogStack.indexOf(backdrop);
      if (i >= 0) _dialogStack.splice(i, 1);
      document.removeEventListener("keydown", onKey, true);
    };
    const finish = (result) => {
      cleanup();
      resolve(result);
    };
    const onOk = () => {
      if (kind === "alert") finish(undefined);
      else if (kind === "confirm") finish(true);
      else finish(input.value);
    };
    const onCancel = () => {
      if (kind === "alert") finish(undefined);
      else if (kind === "confirm") finish(false);
      else finish(null);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) onCancel();
    });
    const onKey = (e) => {
      // Only the topmost dialog handles keys
      if (_dialogStack[_dialogStack.length - 1] !== backdrop) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter") {
        if (
          kind === "alert" ||
          kind === "confirm" ||
          (kind === "prompt" && document.activeElement === input)
        ) {
          e.preventDefault();
          e.stopPropagation();
          onOk();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

const showAlert = (opts) =>
  showDialog({ kind: "alert", ...(typeof opts === "string" ? { message: opts } : opts) });
const showConfirm = (opts) =>
  showDialog({ kind: "confirm", ...(typeof opts === "string" ? { message: opts } : opts) });
const showPrompt = (opts) =>
  showDialog({ kind: "prompt", ...(typeof opts === "string" ? { message: opts } : opts) });

/* Folder picker: a list of clickable folder rows + Uncategorized + create-new.
   Resolves to:
     undefined → user cancelled (caller should abort)
     null      → "Uncategorized" / no folder
     string    → folder name (created via API if needed) */
function showFolderPicker({
  folders = [],
  title = "Choose a folder",
  message = "",
  currentFolder = null,
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop dialog-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");

    const modal = document.createElement("div");
    modal.className = "modal modal-dialog folder-picker";
    backdrop.appendChild(modal);

    modal.innerHTML = `
      <div class="modal-head dialog-head"><h2></h2></div>
      ${message ? `<div class="dialog-body"><p class="dialog-message"></p></div>` : ""}
      <div class="folder-picker-list" role="listbox"></div>
      <div class="dialog-footer">
        <button type="button" class="ghost" data-act="cancel">Cancel</button>
      </div>
    `;
    modal.querySelector("h2").textContent = title;
    if (message) modal.querySelector(".dialog-message").textContent = message;

    const list = modal.querySelector(".folder-picker-list");
    const rows = [
      { value: null, label: "Uncategorized", icon: "folder", muted: true },
      ...folders.map((f) => ({ value: f, label: f, icon: "folder" })),
      { value: "__new__", label: "Create new folder…", icon: "folder", isNew: true },
    ];
    for (const r of rows) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "folder-picker-row";
      if (r.isNew) btn.classList.add("folder-picker-new");
      if (r.muted) btn.classList.add("folder-picker-muted");
      const isCurrent =
        !r.isNew &&
        ((r.value === null && currentFolder == null) ||
          (typeof r.value === "string" && r.value === currentFolder));
      if (isCurrent) btn.classList.add("current");
      btn.innerHTML =
        `<svg class="icon"><use href="#icon-${r.icon}"/></svg>` +
        `<span class="folder-picker-label">${escapeHtml(r.label)}</span>` +
        (isCurrent ? `<span class="folder-picker-check">✓</span>` : "");
      btn.addEventListener("click", () => onPick(r));
      list.appendChild(btn);
    }

    document.body.appendChild(backdrop);
    _dialogStack.push(backdrop);
    setTimeout(() => list.querySelector(".folder-picker-row")?.focus(), 30);

    const cleanup = () => {
      backdrop.remove();
      const i = _dialogStack.indexOf(backdrop);
      if (i >= 0) _dialogStack.splice(i, 1);
      document.removeEventListener("keydown", onKey, true);
    };
    const finish = (v) => {
      cleanup();
      resolve(v);
    };

    async function onPick(r) {
      if (r.isNew) {
        const name = await showPrompt({
          title: "New folder",
          message: "What should we call it?",
          placeholder: "e.g. Work, Study",
          okLabel: "Create",
        });
        if (name === null) return;
        const trimmed = String(name).trim();
        if (!trimmed) return;
        finish(trimmed);
        return;
      }
      finish(r.value);
    }

    modal
      .querySelector('[data-act="cancel"]')
      .addEventListener("click", () => finish(undefined));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(undefined);
    });
    const onKey = (e) => {
      if (_dialogStack[_dialogStack.length - 1] !== backdrop) return;
      if (e.key === "Escape") {
        e.preventDefault();
        finish(undefined);
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

/* ---------------- text highlighting ----------------
   PDF-editor-style highlighter: select text inside a paper, get a small
   floating toolbar with four marker colors + a remove button. Highlights
   live in the DOM as <mark class="hl hl-{color}"> wrappers, are exported
   with PDF/PNG (the existing export captures the rendered DOM), and can be
   persisted by saving a per-paper innerHTML snapshot in the notes JSON. */

const HL_COLORS = ["yellow", "green", "pink", "blue"];

let _hlToolbar = null;
let _hlActiveRange = null; // last range that produced the toolbar

function ensureHlToolbar() {
  if (_hlToolbar) return _hlToolbar;
  const bar = document.createElement("div");
  bar.className = "hl-toolbar";
  bar.innerHTML =
    HL_COLORS.map(
      (c) =>
        `<button type="button" data-hl-color="${c}" title="Highlight ${c}">` +
        `<span class="hl-color-swatch hl-${c}"></span></button>`
    ).join("") +
    `<span class="hl-divider"></span>` +
    `<button type="button" class="hl-remove" data-hl-remove="1" title="Remove highlight">` +
    `<svg><use href="#icon-x"/></svg></button>`;
  document.body.appendChild(bar);

  // mousedown on toolbar would clear the selection — prevent it so the
  // pending range stays intact when the user clicks a color.
  bar.addEventListener("mousedown", (e) => e.preventDefault());
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.hlColor) {
      applyHighlight(btn.dataset.hlColor);
    } else if (btn.dataset.hlRemove) {
      removeHighlightAtSelection();
    }
    hideHlToolbar();
  });

  _hlToolbar = bar;
  return bar;
}

function hideHlToolbar() {
  if (_hlToolbar) _hlToolbar.classList.remove("visible");
}

function positionHlToolbar(rect) {
  const bar = ensureHlToolbar();
  bar.classList.add("visible");
  // measure after making visible so width is real
  const bw = bar.offsetWidth || 200;
  const bh = bar.offsetHeight || 40;
  // prefer above selection; fall back below if too close to top
  let left = rect.left + rect.width / 2 - bw / 2;
  left = Math.max(8, Math.min(window.innerWidth - bw - 8, left));
  let top = rect.top - bh - 8;
  if (top < 8) top = rect.bottom + 8;
  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(top)}px`;
}

document.addEventListener("selectionchange", () => {
  // Skip while flipping pages or capturing for export — selection events fire
  // a lot and we don't want to flash the toolbar mid-animation.
  if (papersEl?.classList.contains("capturing")) return hideHlToolbar();

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return hideHlToolbar();
  const range = sel.getRangeAt(0);
  if (!isRangeInsideNotes(range)) return hideHlToolbar();
  // Empty selection visually (only whitespace)?
  if (!range.toString().trim()) return hideHlToolbar();
  _hlActiveRange = range.cloneRange();
  positionHlToolbar(range.getBoundingClientRect());
});
window.addEventListener("scroll", hideHlToolbar, true);
window.addEventListener("resize", hideHlToolbar);

// Click on an existing highlight while no selection is open → re-show the
// toolbar at that highlight so users can change color or remove it.
document.addEventListener("click", (e) => {
  const mark = e.target.closest("mark.hl");
  const sel = window.getSelection();
  if (!mark || (sel && !sel.isCollapsed)) return;
  // Synthesize a range covering the whole mark for "remove" to target.
  const r = document.createRange();
  r.selectNodeContents(mark);
  _hlActiveRange = r;
  positionHlToolbar(mark.getBoundingClientRect());
});

function isRangeInsideNotes(range) {
  const node = range.commonAncestorContainer;
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (!el) return false;
  return !!el.closest(".paper .notes");
}

/* Wrap the current selection (or _hlActiveRange) in <mark class="hl hl-X">. */
function applyHighlight(color) {
  const range = currentEditableRange();
  if (!range) return;
  const mark = document.createElement("mark");
  mark.className = `hl hl-${color}`;
  try {
    range.surroundContents(mark);
  } catch {
    const frag = range.extractContents();
    mark.appendChild(frag);
    range.insertNode(mark);
  }
  window.getSelection()?.removeAllRanges();
  capturePaperHtml(mark.closest(".paper"));
}

/* Remove highlight: unwrap any <mark.hl> that intersects the active range. */
function removeHighlightAtSelection() {
  const range = currentEditableRange();
  if (!range) return;
  const rootNode =
    range.commonAncestorContainer.nodeType === 3
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
  if (!rootNode) return;
  const candidates = new Set();
  let p = rootNode;
  while (p && p !== document.body) {
    if (p.nodeType === 1 && p.matches?.("mark.hl")) candidates.add(p);
    p = p.parentNode;
  }
  rootNode.querySelectorAll?.("mark.hl")?.forEach((m) => {
    if (rangeIntersectsNode(range, m)) candidates.add(m);
  });
  const paperEl = rootNode.closest?.(".paper");
  for (const m of candidates) unwrap(m);
  window.getSelection()?.removeAllRanges();
  capturePaperHtml(paperEl);
}

function rangeIntersectsNode(range, node) {
  const r = document.createRange();
  r.selectNodeContents(node);
  return (
    range.compareBoundaryPoints(Range.END_TO_START, r) <= 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, r) >= 0
  );
}

function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function currentEditableRange() {
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return sel.getRangeAt(0);
  return _hlActiveRange || null;
}

/* When highlights change inside a paper, snapshot its rendered .notes HTML
   onto the matching session entry so a later Save persists them. */
function capturePaperHtml(paper) {
  if (!paper) return;
  const sourceId = paper.dataset.sourceId;
  if (!sourceId) return;
  const notesEl = paper.querySelector(".notes");
  if (!notesEl) return;
  const html = notesEl.innerHTML;
  for (const entry of currentSession.papers) {
    if (entry.sourceId === sourceId) {
      entry.notesHtml = html;
      break;
    }
  }
}

/* On reload of saved notes, swap a paper's freshly-rendered .notes innerHTML
   for the snapshot we stored at save-time (which has the user's highlight
   marks in it). Run on the next frame so layout has settled before the
   pagination + shape-drawing passes inside appendNotesPaper see it. */
function restorePaperHtmlIfPresent(sourceId, notesHtml) {
  if (!notesHtml) return;
  // appendNotesPaper kicks off async layout work; wait for it then patch.
  requestAnimationFrame(() => {
    const paper = document.getElementById(sourceId);
    const notesEl = paper?.querySelector(".notes");
    if (notesEl) notesEl.innerHTML = notesHtml;
  });
}
