// Простой движок визуальной новеллы: без зависимостей, чистый JS.

(function () {
  "use strict";

  const TYPE_SPEED_MS = 22;      // задержка между символами при печати
  const SKIP_STEP_MS = 60;       // задержка между строками в режиме пропуска
  const SAVE_KEY_PREFIX = "vn_save_";
  const AUTOSAVE_SLOT = "auto";
  const SLOTS = ["auto", "1", "2", "3"];

  const els = {
    menu: document.getElementById("main-menu"),
    about: document.getElementById("about-screen"),
    game: document.getElementById("game-screen"),
    saveScreen: document.getElementById("save-screen"),
    background: document.getElementById("background"),
    charSlots: {
      left: document.getElementById("char-left"),
      center: document.getElementById("char-center"),
      right: document.getElementById("char-right"),
    },
    choices: document.getElementById("choices"),
    dialogueBox: document.getElementById("dialogue-box"),
    speakerName: document.getElementById("speaker-name"),
    dialogueText: document.getElementById("dialogue-text"),
    continueIndicator: document.getElementById("continue-indicator"),
    toast: document.getElementById("toast"),
    saveSlots: document.getElementById("save-slots"),
    saveScreenTitle: document.getElementById("save-screen-title"),
  };

  // Индексируем метки скрипта.
  const labels = {};
  SCRIPT.forEach((cmd, i) => {
    if (cmd.label) labels[cmd.label] = i;
  });

  const state = {
    index: -1,           // индекс текущей отображённой команды (say/choice/end)
    bgClass: "bg-street",
    chars: { left: null, center: null, right: null },
    speaking: null,      // кто сейчас говорит (для затемнения остальных)
    typing: false,
    typeTimer: null,
    skipping: false,
    saveMode: "save",    // "save" | "load" — что показывает экран сохранений
  };

  function showScreen(el) {
    [els.menu, els.about, els.game, els.saveScreen].forEach((s) => s.classList.remove("active"));
    el.classList.add("active");
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove("show"), 1600);
  }

  // ---------- Персонажи и фон ----------

  function applyBackground() {
    els.background.className = state.bgClass;
  }

  function renderCharacters() {
    ["left", "center", "right"].forEach((pos) => {
      const id = state.chars[pos];
      const slot = els.charSlots[pos];
      slot.innerHTML = "";
      if (!id) {
        slot.classList.remove("visible", "dimmed");
        return;
      }
      const info = CHARACTERS[id];
      const figure = document.createElement("div");
      figure.className = "char-figure";
      figure.style.background = `linear-gradient(180deg, ${info.color} 0%, ${shade(info.color, -25)} 100%)`;
      const label = document.createElement("div");
      label.className = "char-label";
      label.textContent = info.name;
      slot.appendChild(figure);
      slot.appendChild(label);
      slot.classList.add("visible");
      slot.classList.toggle("dimmed", !!state.speaking && state.speaking !== id);
    });
  }

  function shade(hex, percent) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + Math.round((percent / 100) * 255);
    let g = ((n >> 8) & 0xff) + Math.round((percent / 100) * 255);
    let b = (n & 0xff) + Math.round((percent / 100) * 255);
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }

  // ---------- Печать текста ----------

  function typeText(text, done) {
    clearTimeout(state.typeTimer);
    els.dialogueText.textContent = "";
    els.continueIndicator.classList.remove("show");
    state.typing = true;

    if (state.skipping) {
      els.dialogueText.textContent = text;
      state.typing = false;
      els.continueIndicator.classList.add("show");
      if (done) done();
      return;
    }

    let i = 0;
    function step() {
      if (!state.typing) return; // была прервана (skipTyping)
      els.dialogueText.textContent = text.slice(0, i);
      i++;
      if (i <= text.length) {
        state.typeTimer = setTimeout(step, TYPE_SPEED_MS);
      } else {
        state.typing = false;
        els.continueIndicator.classList.add("show");
        if (done) done();
      }
    }
    step();
  }

  function finishTypingInstantly() {
    clearTimeout(state.typeTimer);
    const full = els.dialogueText._fullText || els.dialogueText.textContent;
    els.dialogueText.textContent = full;
    state.typing = false;
    els.continueIndicator.classList.add("show");
  }

  // ---------- Выполнение сценария ----------

  function applyStateCommand(cmd) {
    if (cmd.bg) {
      state.bgClass = "bg-" + cmd.bg;
      applyBackground();
    }
    if (cmd.show) {
      const info = CHARACTERS[cmd.show];
      state.chars[info.at] = cmd.show;
      renderCharacters();
    }
    if (cmd.hide) {
      Object.keys(state.chars).forEach((pos) => {
        if (state.chars[pos] === cmd.hide) state.chars[pos] = null;
      });
      renderCharacters();
    }
  }

  // Прогоняем управляющие команды (label/bg/show/hide/jump), пока не встретим
  // say/narrate/choice/end — то, что реально нужно показать игроку и на чём
  // остановиться в ожидании его действия.
  function runFrom(startIndex) {
    let i = startIndex;
    let guard = 0;
    while (i < SCRIPT.length) {
      if (++guard > 5000) { console.error("Похоже на бесконечный цикл в сценарии"); return; }
      const cmd = SCRIPT[i];

      if (cmd.label !== undefined) { i++; continue; }
      if (cmd.jump) { i = labels[cmd.jump]; continue; }
      if (cmd.bg || cmd.show || cmd.hide) { applyStateCommand(cmd); i++; continue; }

      // Останавливающие команды.
      display(i);
      return;
    }
    // Скрипт закончился без явной команды end — просто вернёмся в меню.
    returnToMenu();
  }

  // Отображает команду по индексу, не продвигаясь дальше (используется и при runFrom, и при загрузке сейва).
  function display(i) {
    const cmd = SCRIPT[i];
    state.index = i;
    applyBackground();
    renderCharacters();

    if (cmd.say !== undefined) {
      const isYou = cmd.say === "you";
      state.speaking = isYou ? null : cmd.say;
      renderCharacters();
      els.speakerName.textContent = isYou ? "Вы" : CHARACTERS[cmd.say].name;
      els.choices.classList.add("hidden");
      els.dialogueBox.classList.remove("hidden");
      els.dialogueText._fullText = cmd.text;
      typeText(cmd.text, autosave);
      return;
    }

    if (cmd.narrate !== undefined) {
      state.speaking = null;
      renderCharacters();
      els.speakerName.textContent = "";
      els.choices.classList.add("hidden");
      els.dialogueBox.classList.remove("hidden");
      els.dialogueText._fullText = cmd.narrate;
      typeText(cmd.narrate, autosave);
      return;
    }

    if (cmd.choice) {
      els.dialogueBox.classList.add("hidden");
      renderChoices(cmd.choice);
      autosave();
      return;
    }

    if (cmd.end !== undefined) {
      state.speaking = null;
      renderCharacters();
      els.choices.classList.add("hidden");
      els.dialogueBox.classList.remove("hidden");
      els.speakerName.textContent = "Конец";
      els.dialogueText._fullText = cmd.end + "\n\nНажмите, чтобы вернуться в меню.";
      typeText(els.dialogueText._fullText);
      clearAutosave();
      return;
    }
  }

  function renderChoices(options) {
    els.choices.innerHTML = "";
    els.choices.classList.remove("hidden");
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.textContent = opt.text;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        els.choices.classList.add("hidden");
        runFrom(labels[opt.goto]);
      });
      els.choices.appendChild(btn);
    });
  }

  function advance() {
    const cmd = SCRIPT[state.index];
    if (!cmd) return;

    if (state.typing) {
      finishTypingInstantly();
      return;
    }
    if (cmd.choice) return; // ждём клика по варианту
    if (cmd.end !== undefined) {
      returnToMenu();
      return;
    }
    runFrom(state.index + 1);
  }

  function returnToMenu() {
    state.skipping = false;
    els.btnSkipUpdate && els.btnSkipUpdate();
    showScreen(els.menu);
    updateContinueButton();
  }

  // ---------- Новая игра ----------

  function newGame() {
    state.bgClass = "bg-street";
    state.chars = { left: null, center: null, right: null };
    state.speaking = null;
    state.skipping = false;
    showScreen(els.game);
    runFrom(labels["start"]);
  }

  // ---------- Сохранения ----------

  function snapshot() {
    return {
      index: state.index,
      bgClass: state.bgClass,
      chars: { ...state.chars },
      time: Date.now(),
    };
  }

  function saveToSlot(slot) {
    localStorage.setItem(SAVE_KEY_PREFIX + slot, JSON.stringify(snapshot()));
  }

  function loadSlotData(slot) {
    const raw = localStorage.getItem(SAVE_KEY_PREFIX + slot);
    return raw ? JSON.parse(raw) : null;
  }

  function autosave() {
    saveToSlot(AUTOSAVE_SLOT);
    updateContinueButton();
  }

  function clearAutosave() {
    localStorage.removeItem(SAVE_KEY_PREFIX + AUTOSAVE_SLOT);
    updateContinueButton();
  }

  function restoreFromData(data) {
    state.index = data.index;
    state.bgClass = data.bgClass;
    state.chars = { ...data.chars };
    showScreen(els.game);
    display(data.index);
  }

  function updateContinueButton() {
    const has = !!loadSlotData(AUTOSAVE_SLOT);
    document.getElementById("btn-continue").disabled = !has;
  }

  function renderSaveSlots() {
    els.saveSlots.innerHTML = "";
    els.saveScreenTitle.textContent = state.saveMode === "save" ? "Сохранить игру" : "Загрузить игру";
    SLOTS.forEach((slot) => {
      const data = loadSlotData(slot);
      const div = document.createElement("div");
      div.className = "save-slot";
      const title = document.createElement("div");
      title.className = "slot-title";
      title.textContent = slot === AUTOSAVE_SLOT ? "Автосохранение" : "Слот " + slot;
      div.appendChild(title);

      const info = document.createElement("div");
      if (data) {
        const d = new Date(data.time);
        info.textContent = d.toLocaleString();
      } else {
        info.textContent = "— пусто —";
        info.className = "slot-empty";
      }
      div.appendChild(info);

      div.addEventListener("click", () => {
        if (state.saveMode === "save") {
          if (slot === AUTOSAVE_SLOT) { toast("Автослот только для чтения"); return; }
          saveToSlot(slot);
          toast("Сохранено в слот " + slot);
          renderSaveSlots();
        } else {
          if (!data) { toast("Слот пуст"); return; }
          restoreFromData(data);
        }
      });
      els.saveSlots.appendChild(div);
    });
  }

  // ---------- Пропуск ----------

  function toggleSkip() {
    state.skipping = !state.skipping;
    document.getElementById("btn-skip").style.opacity = state.skipping ? "1" : "0.6";
    if (state.skipping) skipLoop();
  }

  function skipLoop() {
    if (!state.skipping) return;
    if (!els.game.classList.contains("active")) { state.skipping = false; return; }
    const cmd = SCRIPT[state.index];
    if (!cmd || cmd.choice || cmd.end !== undefined) { state.skipping = false; document.getElementById("btn-skip").style.opacity = "0.6"; return; }
    advance();
    setTimeout(skipLoop, SKIP_STEP_MS);
  }

  // ---------- Обработчики ----------

  document.getElementById("btn-start").addEventListener("click", newGame);

  document.getElementById("btn-continue").addEventListener("click", () => {
    const data = loadSlotData(AUTOSAVE_SLOT);
    if (data) restoreFromData(data);
  });

  document.getElementById("btn-about").addEventListener("click", () => showScreen(els.about));
  document.getElementById("btn-about-back").addEventListener("click", () => showScreen(els.menu));

  document.getElementById("btn-menu").addEventListener("click", () => {
    autosave();
    returnToMenu();
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    state.saveMode = "save";
    renderSaveSlots();
    showScreen(els.saveScreen);
  });

  document.getElementById("btn-load").addEventListener("click", () => {
    state.saveMode = "load";
    renderSaveSlots();
    showScreen(els.saveScreen);
  });

  document.getElementById("btn-save-back").addEventListener("click", () => showScreen(els.game));

  document.getElementById("btn-skip").addEventListener("click", toggleSkip);

  els.dialogueBox.addEventListener("click", advance);

  document.addEventListener("keydown", (e) => {
    if (!els.game.classList.contains("active")) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      advance();
    }
  });

  updateContinueButton();
})();
