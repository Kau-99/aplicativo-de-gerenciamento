(() => {
  "use strict";

  /* ─── Config ─────────────────────────────────── */
  const APP = {
    dbName: "jobcost_pro_db",
    dbVersion: 4,
    stores: { jobs: "jobs", timeLogs: "timeLogs", templates: "templates" },
    lsKey: "jobcost_pro_v2",
  };

  /* ─── Utils ──────────────────────────────────── */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const uid = () => `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const esc = (v) =>
    String(v ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const fmt = (n) =>
    Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString("pt-BR") : "—");
  const fmtDateInput = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");
  const parseDate = (s) => (s ? new Date(s).getTime() : null);
  const jobCost = (job) =>
    (job.costs || []).reduce((s, c) => s + (c.qty || 0) * (c.unitCost || 0), 0);
  const fmtDuration = (ms) => {
    const s = Math.floor(Math.max(0, ms) / 1000);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
      .map((n) => String(n).padStart(2, "0")).join(":");
  };

  /* ─── LocalStore ─────────────────────────────── */
  const ls = (key, defs = {}) => ({
    load: () => {
      try { return { ...defs, ...(JSON.parse(localStorage.getItem(key)) || {}) }; }
      catch { return { ...defs }; }
    },
    save: (v) => localStorage.setItem(key, JSON.stringify(v)),
  });

  /* ─── State ──────────────────────────────────── */
  const state = {
    route: "dashboard",
    jobs: [],
    timeLogs: [],
    templates: [],
    settings: ls(APP.lsKey, { role: "admin", theme: "dark", company: "" }).load(),
    fieldSession: { active: false, data: null },
    search: "",
    sort: { col: "date", dir: "desc" },
    filter: "all",
    dateFilter: { from: null, to: null },
    liveTimer: null,
  };

  /* ─── IndexedDB ──────────────────────────────── */
  const idb = (() => {
    let db;
    const wrap = (r) => new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return {
      open: () => new Promise((resolve, reject) => {
        const r = indexedDB.open(APP.dbName, APP.dbVersion);
        r.onupgradeneeded = () => {
          const d = r.result;
          Object.values(APP.stores).forEach((s) => {
            if (!d.objectStoreNames.contains(s))
              d.createObjectStore(s, { keyPath: "id" });
          });
        };
        r.onsuccess = () => { db = r.result; resolve(db); };
        r.onerror = () => reject(r.error);
      }),
      getAll: (s) => wrap(db.transaction(s, "readonly").objectStore(s).getAll()),
      put: (s, v) => wrap(db.transaction(s, "readwrite").objectStore(s).put(v)),
      del: (s, id) => wrap(db.transaction(s, "readwrite").objectStore(s).delete(id)),
    };
  })();

  /* ─── Toast ──────────────────────────────────── */
  const toast = (() => {
    function show(type, title, msg, ms = 4200) {
      const c = $("#toasts");
      if (c.children.length >= 4) c.firstChild.remove();
      const el = document.createElement("div");
      el.className = `toast ${type}`;
      el.innerHTML = `
        <div class="dot"></div>
        <div class="tMain">
          <div class="tTitle">${esc(title)}</div>
          ${msg ? `<div class="tMsg">${esc(msg)}</div>` : ""}
        </div>
        <button type="button" class="tX" aria-label="Fechar">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>`;
      const kill = () => {
        el.style.opacity = "0";
        el.style.transform = "translateY(8px)";
        setTimeout(() => el.remove(), 200);
      };
      el.querySelector(".tX").addEventListener("click", kill);
      c.appendChild(el);
      if (ms > 0) setTimeout(kill, ms);
    }
    return {
      success: (t, m) => show("success", t, m),
      error: (t, m) => show("error", t, m),
      warn: (t, m) => show("warn", t, m),
      info: (t, m) => show("info", t, m),
    };
  })();

  /* ─── Modal ──────────────────────────────────── */
  const modal = (() => {
    let stack = [];
    const root = () => $("#modalRoot");

    function open(html, onClose) {
      const r = root();
      r.innerHTML = `<div class="modalOverlay"></div><div class="modal">${html}</div>`;
      r.style.pointerEvents = "auto";
      stack.push(onClose || null);
      r.querySelector(".modalOverlay").addEventListener("click", close);
      r.querySelectorAll(".closeX").forEach((x) => x.addEventListener("click", close));
      setTimeout(() => {
        const first = r.querySelector("input:not([type=file]):not([type=date]), select, textarea");
        first?.focus();
      }, 60);
      return r.querySelector(".modal");
    }

    function close() {
      const r = root();
      r.innerHTML = "";
      r.style.pointerEvents = "none";
      stack.pop()?.();
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && stack.length) close();
    });

    return { open, close };
  })();

  /* ─── Confirm helper ─────────────────────────── */
  function confirm(title, body, danger, onOk) {
    const m = modal.open(`
      <div class="modalHd">
        <div><h2>${esc(title)}</h2><p>${esc(body)}</p></div>
        <button type="button" class="closeX" aria-label="Fechar">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="modalBd"><p class="muted">Esta ação não pode ser desfeita.</p></div>
      <div class="modalFt">
        <button type="button" class="btn" id="cCancel">Cancelar</button>
        <button type="button" class="btn danger" id="cOk">${esc(danger)}</button>
      </div>`);
    m.querySelector("#cCancel").addEventListener("click", modal.close);
    m.querySelector("#cOk").addEventListener("click", () => { modal.close(); onOk(); });
  }

  /* ─── Boot ───────────────────────────────────── */
  async function init() {
    document.body.setAttribute("data-role", state.settings.role);
    applyTheme(state.settings.theme);
    const wrap = $("#appContent");
    if (wrap) wrap.innerHTML = `<div class="loadingPage"><div class="spinner"></div><span>Carregando…</span></div>`;
    try {
      await idb.open();
      [state.jobs, state.timeLogs, state.templates] = await Promise.all([
        idb.getAll(APP.stores.jobs),
        idb.getAll(APP.stores.timeLogs),
        idb.getAll(APP.stores.templates),
      ]);
      bindUI();
      routeTo(location.hash.replace("#", "") || "dashboard", false);
      setTimeout(checkDeadlines, 1200);
      registerSW();
    } catch (e) {
      console.error(e);
      toast.error("Erro de banco de dados", "Falha ao carregar dados locais.");
      if (wrap) wrap.innerHTML = `<div class="empty">Falha ao carregar. Recarregue a página.</div>`;
    }
  }

  function registerSW() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  function checkDeadlines() {
    const now = Date.now();
    const soon = now + 3 * 24 * 60 * 60 * 1000;
    const overdue = state.jobs.filter(
      (j) => j.deadline && j.deadline < now && !["Completed", "Invoiced"].includes(j.status)
    );
    const upcoming = state.jobs.filter(
      (j) => j.deadline && j.deadline >= now && j.deadline <= soon && !["Completed", "Invoiced"].includes(j.status)
    );
    if (overdue.length) toast.error("Prazo vencido", `${overdue.length} job(s) com prazo expirado.`);
    if (upcoming.length) toast.warn("Prazo próximo", `${upcoming.length} job(s) vencem em até 3 dias.`);
  }

  function bindUI() {
    /* Nav */
    $$(".navItem").forEach((btn) =>
      btn.addEventListener("click", () => routeTo(btn.dataset.route))
    );

    /* Theme */
    $("#btnTheme")?.addEventListener("click", () => {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      ls(APP.lsKey).save(state.settings);
      applyTheme(state.settings.theme);
    });

    window.addEventListener("hashchange", () =>
      routeTo(location.hash.replace("#", "") || "dashboard", false)
    );

    /* Mobile sidebar */
    const sidebar = $("#sidebar"), overlay = $("#drawerOverlay");
    $("#btnMobileMenu")?.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      overlay.hidden = !overlay.hidden;
    });
    overlay?.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.hidden = true;
    });

    /* Topbar actions */
    $("#btnNewJob")?.addEventListener("click", () => openJobModal(null));
    $("#btnNewTemplate")?.addEventListener("click", () => openTemplateModal(null));
    $("#btnExportAll")?.addEventListener("click", doExport);

    /* Search */
    const si = $("#globalSearch"), cl = $("#btnClearSearch");
    cl.hidden = true;
    si?.addEventListener("input", () => {
      state.search = si.value.trim().toLowerCase();
      cl.hidden = !si.value;
      if (["jobs", "dashboard"].includes(state.route)) render();
    });
    cl?.addEventListener("click", () => {
      si.value = ""; state.search = ""; cl.hidden = true; si.focus(); render();
    });

    /* Keyboard shortcuts */
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); si?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "n" && !$("#modalRoot").children.length) {
        e.preventDefault(); openJobModal(null);
      }
    });
  }

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
  }

  function routeTo(route, push = true) {
    const valid = ["dashboard", "jobs", "field", "views", "settings", "templates"];
    state.route = valid.includes(route) ? route : "dashboard";
    if (state.settings.role === "field" && !["dashboard", "field"].includes(state.route)) {
      state.route = "field";
    }
    if (push) location.hash = state.route;
    $$(".navItem").forEach((btn) =>
      btn.setAttribute("aria-current", btn.dataset.route === state.route ? "page" : "false")
    );
    /* Clean up live timer when leaving field */
    if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
    render();
  }

  function render() {
    const wrap = $("#appContent");
    if (!wrap) return;
    wrap.innerHTML = "";
    const views = {
      dashboard: renderDashboard,
      jobs: renderJobs,
      templates: renderTemplates,
      field: renderFieldApp,
      views: renderBI,
      settings: renderSettings,
    };
    (views[state.route] || renderDashboard)(wrap);
  }

  /* ─── Export JSON backup ─────────────────────── */
  function doExport() {
    const data = { jobs: state.jobs, timeLogs: state.timeLogs, templates: state.templates };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `jobcost_backup_${Date.now()}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Backup exportado", `${state.jobs.length} jobs · ${state.templates.length} templates.`);
  }

  /* ─── PDF: Relatório do Job ──────────────────── */
  function exportJobPDF(job) {
    if (!window.jspdf) { toast.error("Erro PDF", "jsPDF não carregado."); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const lm = 14;
    let y = 22;

    doc.setFontSize(20); doc.setFont("helvetica", "bold");
    doc.text("JobCost Pro", lm, y);
    if (state.settings.company) {
      doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
      doc.text(state.settings.company, lm, y + 7); y += 6;
    }
    y += 8;
    doc.setFontSize(11); doc.setFont("helvetica", "normal");
    doc.setTextColor(120); doc.text(`Relatório gerado em ${fmtDate(Date.now())}`, lm, y);
    doc.setTextColor(0); y += 10;
    doc.line(lm, y, 196, y); y += 8;

    const infoRow = (lbl, val) => {
      doc.setFont("helvetica", "bold"); doc.text(`${lbl}:`, lm, y);
      doc.setFont("helvetica", "normal"); doc.text(String(val ?? "—"), lm + 42, y);
      y += 7;
    };
    doc.setFontSize(11);
    infoRow("Job", job.name);
    infoRow("Cliente", job.client || "—");
    infoRow("Status", job.status);
    infoRow("Criado em", fmtDate(job.date));
    if (job.startDate) infoRow("Início", fmtDate(job.startDate));
    if (job.deadline) infoRow("Prazo", fmtDate(job.deadline));
    infoRow("Valor Estimado", fmt(job.value));
    if (job.estimatedHours) {
      infoRow("Horas Estimadas", `${job.estimatedHours}h`);
      const realHrs = state.timeLogs.filter((l) => l.jobId === job.id).reduce((s, l) => s + (l.hours || 0), 0);
      infoRow("Horas Reais", `${realHrs.toFixed(2)}h`);
    }
    if (job.notes) {
      const lines = doc.splitTextToSize(job.notes, 140);
      infoRow("Notas", lines[0]);
      lines.slice(1).forEach((l) => { doc.text(l, lm + 42, y); y += 6; });
    }

    const costs = job.costs || [];
    if (costs.length) {
      y += 6; doc.line(lm, y, 196, y); y += 8;
      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text("Detalhamento de Custos", lm, y); y += 8;
      doc.setFontSize(9);
      doc.setFillColor(20, 30, 55); doc.rect(lm, y - 5, 182, 7, "F");
      doc.setTextColor(200, 210, 230);
      const cols = [lm + 1, 88, 126, 145, 173];
      ["Descrição", "Categoria", "Qtd", "Custo Unit.", "Total"].forEach((h, i) =>
        doc.text(h, cols[i], y)
      );
      y += 5; doc.setTextColor(0);
      costs.forEach((c, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        if (i % 2 === 0) { doc.setFillColor(245, 246, 249); doc.rect(lm, y - 4, 182, 7, "F"); }
        doc.setFont("helvetica", "normal");
        const ct = (c.qty || 0) * (c.unitCost || 0);
        [String(c.description || "").slice(0, 34), c.category || "", String(c.qty || 0), fmt(c.unitCost), fmt(ct)]
          .forEach((v, i) => doc.text(v, cols[i], y));
        y += 7;
      });
      y += 4; doc.line(lm, y, 196, y); y += 8;
      const tc = jobCost(job), margin = (job.value || 0) - tc;
      const pct = job.value ? ((margin / job.value) * 100).toFixed(1) : "—";
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      [`Custo Total: ${fmt(tc)}`, `Valor Estimado: ${fmt(job.value)}`, `Lucro / Prejuízo: ${fmt(margin)} (${pct}%)`]
        .forEach((t) => { doc.text(t, lm, y); y += 7; });
    }

    const logs = state.timeLogs.filter((l) => l.jobId === job.id);
    if (logs.length) {
      y += 6; doc.line(lm, y, 196, y); y += 8;
      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text("Registro de Horas", lm, y); y += 8;
      doc.setFontSize(9);
      doc.setFillColor(20, 30, 55); doc.rect(lm, y - 5, 150, 7, "F");
      doc.setTextColor(200, 210, 230);
      doc.text("Data", lm + 1, y); doc.text("Horas", lm + 42, y); doc.text("Observação", lm + 70, y);
      y += 5; doc.setTextColor(0);
      logs.sort((a, b) => b.date - a.date).forEach((l, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        if (i % 2 === 0) { doc.setFillColor(245, 246, 249); doc.rect(lm, y - 4, 150, 7, "F"); }
        doc.setFont("helvetica", "normal");
        doc.text(fmtDate(l.date), lm + 1, y);
        doc.text(`${(l.hours || 0).toFixed(2)}h`, lm + 42, y);
        if (l.note) doc.text(String(l.note).slice(0, 50), lm + 70, y);
        y += 7;
      });
      y += 4; doc.setFont("helvetica", "bold");
      doc.text(`Total: ${logs.reduce((s, l) => s + (l.hours || 0), 0).toFixed(2)}h`, lm, y);
    }

    doc.save(`${job.name.replace(/[^a-z0-9]/gi, "_").slice(0, 48)}_relatorio.pdf`);
    toast.success("PDF exportado", job.name);
  }

  /* ─── PDF: Relatório Geral ───────────────────── */
  function exportAllPDF() {
    if (!window.jspdf) { toast.error("Erro PDF", "jsPDF não carregado."); return; }
    if (!state.jobs.length) { toast.warn("Sem dados", "Nenhum job para exportar."); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape" });
    const lm = 14;
    let y = 22;

    doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text("JobCost Pro — Relatório Geral", lm, y);
    if (state.settings.company) {
      doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
      doc.text(state.settings.company, lm, y + 7); y += 6;
    }
    y += 8;
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(120);
    doc.text(`Gerado em ${fmtDate(Date.now())} · ${state.jobs.length} jobs`, lm, y);
    doc.setTextColor(0); y += 8; doc.line(lm, y, 283, y); y += 8;

    const totalVal = state.jobs.reduce((s, j) => s + (j.value || 0), 0);
    const totalCost = state.jobs.reduce((s, j) => s + jobCost(j), 0);
    const totalHrs = state.timeLogs.reduce((s, l) => s + (l.hours || 0), 0);
    doc.setFontSize(10); doc.setFont("helvetica", "bold");
    doc.text(`Valor Total: ${fmt(totalVal)}   Custo Total: ${fmt(totalCost)}   Horas: ${totalHrs.toFixed(1)}h`, lm, y);
    y += 10;

    doc.setFontSize(8);
    doc.setFillColor(20, 30, 55); doc.rect(lm, y - 5, 269, 7, "F");
    doc.setTextColor(200, 210, 230);
    const cols = [lm + 1, 88, 130, 165, 200, 235, 262];
    ["Job", "Cliente", "Status", "Valor Est.", "Custo Total", "Margem", "Prazo"].forEach((h, i) =>
      doc.text(h, cols[i], y)
    );
    y += 5; doc.setTextColor(0);

    [...state.jobs].sort((a, b) => b.date - a.date).forEach((j, i) => {
      if (y > 190) { doc.addPage(); y = 20; }
      if (i % 2 === 0) { doc.setFillColor(248, 249, 252); doc.rect(lm, y - 4, 269, 7, "F"); }
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      const tc = jobCost(j), m = (j.value || 0) - tc;
      [
        j.name.slice(0, 34),
        (j.client || "—").slice(0, 22),
        j.status,
        fmt(j.value),
        fmt(tc),
        fmt(m),
        j.deadline ? fmtDate(j.deadline) : "—",
      ].forEach((v, i) => doc.text(v, cols[i], y));
      y += 7;
    });

    doc.save(`jobcost_relatorio_geral_${Date.now()}.pdf`);
    toast.success("Relatório exportado", `${state.jobs.length} jobs incluídos.`);
  }

  /* ─── PDF: Fatura ────────────────────────────── */
  function exportInvoicePDF(job) {
    if (!window.jspdf) { toast.error("Erro PDF", "jsPDF não carregado."); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const lm = 14, rr = 196;
    let y = 28;

    doc.setFontSize(28); doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 50, 100); doc.text("FATURA", lm, y);
    doc.setTextColor(0);
    doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.setTextColor(80);
    doc.text(state.settings.company || "JobCost Pro", lm, y + 9);
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.text(`Data: ${fmtDate(Date.now())}`, rr, y, { align: "right" });
    doc.text(`Ref: ${job.name.slice(0, 40)}`, rr, y + 7, { align: "right" });
    y += 22; doc.setDrawColor(180, 185, 200); doc.line(lm, y, rr, y); y += 10;

    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("Para:", lm, y);
    doc.setFont("helvetica", "normal"); doc.text(job.client || "—", lm, y + 7);
    y += 20;

    const costs = job.costs || [];
    if (costs.length) {
      doc.setFontSize(9);
      doc.setFillColor(20, 30, 55); doc.rect(lm, y - 5, 182, 7, "F");
      doc.setTextColor(200, 210, 230);
      const cols = [lm + 1, 90, 122, 145, 173];
      ["Descrição", "Categoria", "Qtd", "Valor Unit.", "Total"].forEach((h, i) =>
        doc.text(h, cols[i], y)
      );
      y += 5; doc.setTextColor(0);
      costs.forEach((c, i) => {
        if (y > 260) { doc.addPage(); y = 20; }
        if (i % 2 === 0) { doc.setFillColor(248, 249, 252); doc.rect(lm, y - 4, 182, 7, "F"); }
        doc.setFont("helvetica", "normal");
        const ct = (c.qty || 0) * (c.unitCost || 0);
        [String(c.description || "").slice(0, 38), c.category || "", String(c.qty || 0), fmt(c.unitCost), fmt(ct)]
          .forEach((v, i) => doc.text(v, cols[i], y));
        y += 7;
      });
    } else {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text("Serviços prestados conforme acordado.", lm, y); y += 10;
    }

    y += 8; doc.setDrawColor(180, 185, 200); doc.line(lm, y, rr, y); y += 10;
    const total = costs.length ? jobCost(job) : (job.value || 0);
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.setTextColor(30, 50, 100);
    doc.text(`TOTAL: ${fmt(total)}`, rr, y, { align: "right" });
    doc.setTextColor(0);

    if (job.notes) {
      y += 18; doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
      doc.text("Observações:", lm, y); y += 6;
      doc.splitTextToSize(job.notes, 170).slice(0, 6).forEach((l) => {
        doc.text(l, lm, y); y += 5;
      });
    }

    doc.save(`fatura_${job.name.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}.pdf`);
    toast.success("Fatura exportada", job.name);
  }

  /* ─── Sort helpers ───────────────────────────── */
  function sorted(list) {
    const { col, dir } = state.sort;
    return [...list].sort((a, b) => {
      let va = a[col] ?? "", vb = b[col] ?? "";
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      return (va < vb ? -1 : va > vb ? 1 : 0) * (dir === "asc" ? 1 : -1);
    });
  }
  const sortIco = (col) =>
    state.sort.col === col
      ? (state.sort.dir === "asc" ? " ↑" : " ↓")
      : `<span class="sort-inactive"> ↕</span>`;
  const th = (col, lbl, align = "") =>
    `<th class="sortable" data-sort="${col}"${align ? ` style="text-align:${align}"` : ""}>${lbl}${sortIco(col)}</th>`;

  /* ─── Save helpers ───────────────────────────── */
  async function saveJob(job) {
    await idb.put(APP.stores.jobs, job);
    const i = state.jobs.findIndex((j) => j.id === job.id);
    if (i !== -1) state.jobs[i] = job; else state.jobs.push(job);
  }

  /* ─── Duplicate Job ──────────────────────────── */
  function duplicateJob(job) {
    const copy = {
      ...job,
      id: uid(),
      name: `${job.name} (Cópia)`,
      status: "Draft",
      date: Date.now(),
      statusHistory: [{ status: "Draft", date: Date.now() }],
      costs: (job.costs || []).map((c) => ({ ...c, id: uid() })),
      photos: [],
    };
    saveJob(copy).then(() => {
      toast.success("Job duplicado", copy.name);
      render();
    });
  }

  /* ─── Job Modal ──────────────────────────────── */
  function openJobModal(job) {
    const isEdit = !!job;
    const STATUS = ["Draft", "Active", "Completed", "Invoiced"];
    const tplOpts = state.templates.length
      ? `<option value="">— nenhum —</option>` +
        state.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")
      : null;

    const m = modal.open(`
      <div class="modalHd">
        <div>
          <h2>${isEdit ? "Editar Job" : "Novo Job"}</h2>
          <p>${isEdit ? esc(job.name) : "Preencha os dados do job."}</p>
        </div>
        <button type="button" class="closeX" aria-label="Fechar">
          <svg viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modalBd">
        <div class="fieldGrid">
          <div class="field">
            <label for="fjN">Nome do Job *</label>
            <input id="fjN" class="input" type="text" maxlength="120" placeholder="ex: Reforma Cozinha" value="${isEdit ? esc(job.name) : ""}"/>
          </div>
          <div class="field">
            <label for="fjC">Cliente</label>
            <input id="fjC" class="input" type="text" maxlength="120" placeholder="Nome do cliente" value="${isEdit ? esc(job.client || "") : ""}"/>
          </div>
          <div class="field">
            <label for="fjSt">Status</label>
            <select id="fjSt">
              ${STATUS.map((s) => `<option value="${s}" ${(isEdit ? job.status : "Draft") === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="fjV">Valor Estimado (R$)</label>
            <input id="fjV" class="input" type="number" min="0" step="0.01" placeholder="0,00" value="${isEdit ? (job.value || "") : ""}"/>
          </div>
          <div class="field">
            <label for="fjSD">Data de Início</label>
            <input id="fjSD" class="input" type="date" value="${isEdit ? fmtDateInput(job.startDate) : ""}"/>
          </div>
          <div class="field">
            <label for="fjDL">Prazo / Entrega</label>
            <input id="fjDL" class="input" type="date" value="${isEdit ? fmtDateInput(job.deadline) : ""}"/>
          </div>
          <div class="field">
            <label for="fjEH">Horas Estimadas</label>
            <input id="fjEH" class="input" type="number" min="0" step="0.5" placeholder="ex: 40" value="${isEdit ? (job.estimatedHours || "") : ""}"/>
          </div>
          ${!isEdit && tplOpts ? `
          <div class="field">
            <label for="fjT">Aplicar Template</label>
            <select id="fjT">${tplOpts}</select>
          </div>` : ""}
          <div class="field" style="grid-column:1/-1;">
            <label for="fjNo">Notas</label>
            <textarea id="fjNo" placeholder="Descrição, observações…">${isEdit ? esc(job.notes || "") : ""}</textarea>
          </div>
        </div>
      </div>
      <div class="modalFt">
        <button type="button" class="btn" id="fjCancel">Cancelar</button>
        <button type="button" class="btn primary" id="fjSave">${isEdit ? "Salvar Alterações" : "Criar Job"}</button>
      </div>`);

    m.querySelector("#fjCancel").addEventListener("click", modal.close);
    m.querySelector("#fjSave").addEventListener("click", () => {
      const nEl = m.querySelector("#fjN");
      const name = nEl.value.trim();
      if (!name) { nEl.classList.add("invalid"); nEl.focus(); return; }
      nEl.classList.remove("invalid");

      const tplId = m.querySelector("#fjT")?.value;
      const tpl = tplId ? state.templates.find((t) => t.id === tplId) : null;
      const newStatus = m.querySelector("#fjSt").value;

      /* Track status history */
      let statusHistory = isEdit
        ? (job.statusHistory || [{ status: job.status, date: job.date }])
        : [{ status: newStatus, date: Date.now() }];
      if (isEdit && job.status !== newStatus) {
        statusHistory = [...statusHistory, { status: newStatus, date: Date.now() }];
      }

      const saved = {
        id: isEdit ? job.id : uid(),
        name,
        client: m.querySelector("#fjC").value.trim(),
        status: newStatus,
        value: parseFloat(m.querySelector("#fjV").value) || 0,
        startDate: parseDate(m.querySelector("#fjSD").value),
        deadline: parseDate(m.querySelector("#fjDL").value),
        estimatedHours: parseFloat(m.querySelector("#fjEH").value) || null,
        notes: m.querySelector("#fjNo").value.trim(),
        date: isEdit ? job.date : Date.now(),
        costs: isEdit ? (job.costs || []) : (tpl ? tpl.costs.map((c) => ({ ...c, id: uid() })) : []),
        photos: isEdit ? (job.photos || []) : [],
        statusHistory,
      };

      saveJob(saved)
        .then(() => {
          toast.success(isEdit ? "Job atualizado" : "Job criado", saved.name);
          modal.close();
          render();
        })
        .catch(() => toast.error("Erro ao salvar", "Não foi possível salvar o job."));
    });
  }

  /* ─── Job Detail Modal (tabbed) ──────────────── */
  function openJobDetailModal(job) {
    let tab = "overview";
    const CATS = ["Materiais", "Mão de Obra", "Subcontratado", "Outros"];

    const getTC = () => jobCost(job);
    const getMargin = () => (job.value || 0) - getTC();
    const getPct = () => job.value ? ((getMargin() / job.value) * 100).toFixed(1) : null;
    const getJobLogs = () => state.timeLogs.filter((l) => l.jobId === job.id);
    const getRealHrs = () => getJobLogs().reduce((s, l) => s + (l.hours || 0), 0);

    /* Tab: Overview */
    const overviewHTML = () => {
      const tc = getTC(), m = getMargin(), pct = getPct();
      const realHrs = getRealHrs();
      const history = (job.statusHistory || []);
      const deadlinePast = job.deadline && job.deadline < Date.now() && !["Completed", "Invoiced"].includes(job.status);
      return `
        <div class="fieldGrid" style="margin-bottom:16px;">
          <div class="field"><label>Cliente</label>
            <div class="infoVal">${esc(job.client || "—")}</div></div>
          <div class="field"><label>Status</label>
            <div style="padding:4px 0;"><span class="badge status-${job.status.toLowerCase()}">${job.status}</span></div></div>
          <div class="field"><label>Início</label>
            <div class="infoVal muted">${fmtDate(job.startDate)}</div></div>
          <div class="field"><label>Prazo</label>
            <div class="infoVal ${deadlinePast ? "deadlineWarn" : "muted"}">${fmtDate(job.deadline)}${deadlinePast ? " ⚠" : ""}</div></div>
          <div class="field"><label>Valor Estimado</label>
            <div class="infoVal bigVal">${fmt(job.value)}</div></div>
          <div class="field"><label>Criado em</label>
            <div class="infoVal muted">${fmtDate(job.date)}</div></div>
          ${job.estimatedHours ? `
          <div class="field"><label>Horas Estimadas</label>
            <div class="infoVal">${job.estimatedHours}h</div></div>
          <div class="field"><label>Horas Reais</label>
            <div class="infoVal" style="color:${realHrs > job.estimatedHours ? "var(--danger)" : "var(--ok)"};">
              ${realHrs.toFixed(2)}h ${realHrs > job.estimatedHours ? "⚠ Excedido" : "✓"}
            </div></div>` : ""}
          ${job.notes ? `
          <div class="field" style="grid-column:1/-1;"><label>Notas</label>
            <div class="notesBox">${esc(job.notes)}</div></div>` : ""}
        </div>
        <div class="summary" style="margin-bottom:16px;">
          <div class="summaryRow"><span class="k">Custo Total dos Itens</span><strong>${fmt(tc)}</strong></div>
          <div class="summaryRow"><span class="k">Valor Estimado</span><strong>${fmt(job.value)}</strong></div>
          <div class="summaryRow total">
            <span class="k">Lucro / Prejuízo</span>
            <strong style="color:${m >= 0 ? "var(--ok)" : "var(--danger)"}">
              ${fmt(m)}${pct !== null ? ` (${pct}%)` : ""}
            </strong>
          </div>
        </div>
        ${history.length > 1 ? `
        <div class="historyBlock">
          <div class="historyTitle">HISTÓRICO DE STATUS</div>
          <div class="historyList">
            ${history.map((h) => `
              <div class="historyRow">
                <span class="muted" style="font-size:12px;">${fmtDate(h.date)}</span>
                <span class="badge status-${(h.status || "draft").toLowerCase()}">${h.status}</span>
              </div>`).join("")}
          </div>
        </div>` : ""}`;
    };

    /* Tab: Costs */
    const costsHTML = () => {
      const costs = job.costs || [];
      const tc = getTC(), m = getMargin(), pct = getPct();
      const rows = costs.length === 0
        ? `<tr><td colspan="6" class="muted" style="padding:18px;text-align:center;">Nenhum item de custo ainda.</td></tr>`
        : costs.map((c, i) => `
            <tr>
              <td>${esc(c.description)}</td>
              <td><span class="badge">${esc(c.category || "")}</span></td>
              <td style="text-align:right;">${c.qty}</td>
              <td style="text-align:right;">${fmt(c.unitCost)}</td>
              <td style="text-align:right;"><strong>${fmt((c.qty || 0) * (c.unitCost || 0))}</strong></td>
              <td>
                <button class="btn danger" data-dci="${i}" style="padding:4px 10px;font-size:11px;">Remover</button>
              </td>
            </tr>`).join("");
      return `
        <div class="tableWrap" style="margin-bottom:14px;">
          <table class="table">
            <thead><tr>
              <th>Descrição</th><th>Categoria</th>
              <th style="text-align:right;">Qtd</th>
              <th style="text-align:right;">Custo Unit.</th>
              <th style="text-align:right;">Total</th>
              <th></th>
            </tr></thead>
            <tbody id="costTbody">${rows}</tbody>
          </table>
        </div>
        <div class="addCostGrid">
          <div class="field"><label for="fcD">Descrição</label><input id="fcD" class="input" type="text" maxlength="100" placeholder="ex: Drywall"/></div>
          <div class="field"><label for="fcC">Categoria</label><select id="fcC">${CATS.map((c) => `<option>${c}</option>`).join("")}</select></div>
          <div class="field"><label for="fcQ">Qtd</label><input id="fcQ" class="input" type="number" min="0.01" step="0.01" value="1"/></div>
          <div class="field"><label for="fcU">Custo Unit. (R$)</label><input id="fcU" class="input" type="number" min="0" step="0.01" placeholder="0,00"/></div>
          <div class="field addCostBtn"><label style="visibility:hidden">a</label><button type="button" class="btn primary" id="btnAC">+ Adicionar</button></div>
        </div>
        <div class="summary">
          <div class="summaryRow"><span class="k">Custo Total</span><strong>${fmt(tc)}</strong></div>
          <div class="summaryRow"><span class="k">Valor Estimado</span><strong>${fmt(job.value)}</strong></div>
          <div class="summaryRow total">
            <span class="k">Lucro / Prejuízo</span>
            <strong style="color:${m >= 0 ? "var(--ok)" : "var(--danger)"}">
              ${fmt(m)}${pct !== null ? ` (${pct}%)` : ""}
            </strong>
          </div>
        </div>`;
    };

    /* Tab: Time Logs */
    const timelogsHTML = () => {
      const logs = state.timeLogs
        .filter((l) => l.jobId === job.id)
        .sort((a, b) => b.date - a.date);
      const total = logs.reduce((s, l) => s + (l.hours || 0), 0);
      if (!logs.length)
        return `<div class="empty">Nenhum registro de horas para este job.</div>`;
      return `
        <div class="tableWrap" style="margin-bottom:14px;">
          <table class="table">
            <thead><tr>
              <th>Data</th>
              <th style="text-align:right;">Horas</th>
              <th>Observação</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${logs.map((l) => `
                <tr>
                  <td>${fmtDate(l.date)}</td>
                  <td style="text-align:right;"><strong>${(l.hours || 0).toFixed(2)}h</strong></td>
                  <td><span class="small">${l.note ? esc(l.note) : `<span class="faint">—</span>`}</span></td>
                  <td>
                    <button class="btn danger" data-dtl="${l.id}" style="padding:4px 10px;font-size:11px;">Remover</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="summaryRow">
          <span class="k">Total Registrado</span>
          <strong>${total.toFixed(2)}h${job.estimatedHours ? ` / ${job.estimatedHours}h estimadas` : ""}</strong>
        </div>`;
    };

    /* Tab: Photos */
    const photosHTML = () => {
      const photos = job.photos || [];
      return `
        <div class="photosHeader">
          <label class="btn photoAddBtn">
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Adicionar Fotos
            <input type="file" id="photoInput" accept="image/*" multiple style="display:none;"/>
          </label>
          <span class="small">${photos.length}/10 fotos</span>
        </div>
        ${photos.length === 0
          ? `<div class="empty">Nenhuma foto adicionada ainda.<br><span class="small">Fotos são salvas localmente no dispositivo.</span></div>`
          : `<div class="photoGrid">
              ${photos.map((p) => `
                <div class="photoThumb">
                  <img src="${p.data}" alt="${esc(p.name)}" loading="lazy" data-pid="${p.id}"/>
                  <button class="photoDelBtn" data-pid="${p.id}" aria-label="Remover foto">✕</button>
                </div>`).join("")}
             </div>`}`;
    };

    const TABS = ["overview", "costs", "timelogs", "photos"];
    const TAB_LABELS = { overview: "Visão Geral", costs: "Custos", timelogs: "Horas", photos: "Fotos" };

    const tabsHTML = () =>
      TABS.map((id) =>
        `<button type="button" class="tab${tab === id ? " active" : ""}" data-tab="${id}">${TAB_LABELS[id]}</button>`
      ).join("");

    const m = modal.open(`
      <div class="modalHd">
        <div>
          <h2>${esc(job.name)}</h2>
          <p>
            ${job.client ? `${esc(job.client)} · ` : ""}
            <span class="badge status-${job.status.toLowerCase()}" style="font-size:11px;padding:2px 8px;">${job.status}</span>
            ${job.deadline ? ` · Prazo: ${fmtDate(job.deadline)}` : ""}
          </p>
        </div>
        <button type="button" class="closeX" aria-label="Fechar">
          <svg viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modalBd">
        <div class="tabs" id="detailTabs">${tabsHTML()}</div>
        <div id="detailContent">${overviewHTML()}</div>
      </div>
      <div class="modalFt">
        <button type="button" class="btn admin-only" id="bjDup">Duplicar</button>
        <button type="button" class="btn admin-only" id="bjEdit">Editar</button>
        <button type="button" class="btn admin-only" id="bjInvoice">Fatura PDF</button>
        <button type="button" class="btn primary admin-only" id="bjPDF">Relatório PDF</button>
        <button type="button" class="btn" id="bjClose">Fechar</button>
      </div>`);

    function switchTab(newTab) {
      tab = newTab;
      m.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      const content = m.querySelector("#detailContent");
      if (tab === "overview") content.innerHTML = overviewHTML();
      else if (tab === "costs") { content.innerHTML = costsHTML(); bindCosts(content); }
      else if (tab === "timelogs") { content.innerHTML = timelogsHTML(); bindTimelogs(content); }
      else if (tab === "photos") { content.innerHTML = photosHTML(); bindPhotos(content); }
    }

    function bindCosts(root) {
      root.querySelectorAll("[data-dci]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.dci, 10);
          job.costs = (job.costs || []).filter((_, i) => i !== idx);
          saveJob(job).then(() => { switchTab("costs"); render(); });
        });
      });
      root.querySelector("#btnAC")?.addEventListener("click", () => {
        const dEl = root.querySelector("#fcD");
        const desc = dEl.value.trim();
        if (!desc) { dEl.classList.add("invalid"); dEl.focus(); return; }
        dEl.classList.remove("invalid");
        job.costs = [...(job.costs || []), {
          id: uid(),
          description: desc,
          category: root.querySelector("#fcC").value,
          qty: parseFloat(root.querySelector("#fcQ").value) || 1,
          unitCost: parseFloat(root.querySelector("#fcU").value) || 0,
        }];
        saveJob(job)
          .then(() => { switchTab("costs"); render(); })
          .catch(() => toast.error("Erro ao salvar", "Não foi possível salvar item."));
      });
    }

    function bindTimelogs(root) {
      root.querySelectorAll("[data-dtl]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.dtl;
          idb.del(APP.stores.timeLogs, id)
            .then(() => {
              state.timeLogs = state.timeLogs.filter((l) => l.id !== id);
              switchTab("timelogs");
              render();
            })
            .catch(() => toast.error("Erro", "Não foi possível remover registro."));
        });
      });
    }

    function bindPhotos(root) {
      root.querySelector("#photoInput")?.addEventListener("change", (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const current = (job.photos || []).length;
        if (current >= 10) { toast.warn("Limite atingido", "Máximo de 10 fotos por job."); return; }
        const toAdd = files.slice(0, 10 - current);
        let done = 0;
        toAdd.forEach((file) => {
          if (file.size > 8 * 1024 * 1024) {
            toast.warn("Arquivo grande", `${file.name} excede 8MB.`);
            done++;
            if (done === toAdd.length) switchTab("photos");
            return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement("canvas");
              const maxW = 1400, maxH = 1400;
              let w = img.width, h = img.height;
              if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
              if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
              canvas.width = w; canvas.height = h;
              canvas.getContext("2d").drawImage(img, 0, 0, w, h);
              const data = canvas.toDataURL("image/jpeg", 0.80);
              job.photos = [...(job.photos || []), { id: uid(), name: file.name, data, date: Date.now() }];
              done++;
              if (done === toAdd.length) saveJob(job).then(() => { switchTab("photos"); render(); });
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(file);
        });
      });

      root.querySelectorAll(".photoDelBtn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pid = btn.dataset.pid;
          job.photos = (job.photos || []).filter((p) => p.id !== pid);
          saveJob(job).then(() => switchTab("photos"));
        });
      });

      root.querySelectorAll(".photoThumb img").forEach((img) => {
        img.addEventListener("click", () => {
          /* Open full-size in a lightbox modal */
          const lb = document.createElement("div");
          lb.className = "lightbox";
          lb.innerHTML = `
            <div class="lightboxBg"></div>
            <img src="${img.src}" class="lightboxImg" alt="Foto"/>
            <button class="lightboxClose" aria-label="Fechar">✕</button>`;
          document.body.appendChild(lb);
          const closeLb = () => lb.remove();
          lb.querySelector(".lightboxBg").addEventListener("click", closeLb);
          lb.querySelector(".lightboxClose").addEventListener("click", closeLb);
          document.addEventListener("keydown", function esc(e) {
            if (e.key === "Escape") { closeLb(); document.removeEventListener("keydown", esc); }
          });
        });
      });
    }

    m.querySelectorAll(".tab").forEach((btn) =>
      btn.addEventListener("click", () => switchTab(btn.dataset.tab))
    );
    m.querySelector("#bjDup").addEventListener("click", () => { modal.close(); duplicateJob(job); });
    m.querySelector("#bjEdit").addEventListener("click", () => { modal.close(); openJobModal(job); });
    m.querySelector("#bjInvoice").addEventListener("click", () => exportInvoicePDF(job));
    m.querySelector("#bjPDF").addEventListener("click", () => exportJobPDF(job));
    m.querySelector("#bjClose").addEventListener("click", modal.close);
  }

  /* ─── Template Modal ─────────────────────────── */
  function openTemplateModal(tpl) {
    const isEdit = !!tpl;
    const CATS = ["Materiais", "Mão de Obra", "Subcontratado", "Outros"];
    const w = isEdit
      ? { ...tpl, costs: (tpl.costs || []).map((c) => ({ ...c })) }
      : { id: uid(), name: "", description: "", date: Date.now(), costs: [] };

    const costRows = () =>
      w.costs.length === 0
        ? `<tr><td colspan="5" class="muted" style="padding:14px;text-align:center;">Nenhum item ainda.</td></tr>`
        : w.costs.map((c, i) => `
            <tr>
              <td>${esc(c.description)}</td>
              <td>${esc(c.category || "")}</td>
              <td style="text-align:right;">${c.qty}</td>
              <td style="text-align:right;">${fmt(c.unitCost)}</td>
              <td><button class="btn danger" data-dtc="${i}" style="padding:4px 10px;font-size:11px;">Remover</button></td>
            </tr>`).join("");

    const m = modal.open(`
      <div class="modalHd">
        <div>
          <h2>${isEdit ? "Editar Template" : "Novo Template"}</h2>
          <p>Templates pré-preenchem itens de custo ao criar um novo job.</p>
        </div>
        <button type="button" class="closeX" aria-label="Fechar">
          <svg viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modalBd" style="display:flex;flex-direction:column;gap:16px;">
        <div class="fieldGrid">
          <div class="field">
            <label for="ftN">Nome *</label>
            <input id="ftN" class="input" type="text" maxlength="100" placeholder="ex: Reforma Padrão" value="${isEdit ? esc(tpl.name) : ""}"/>
          </div>
          <div class="field">
            <label for="ftD">Descrição</label>
            <input id="ftD" class="input" type="text" maxlength="200" placeholder="Opcional" value="${isEdit ? esc(tpl.description || "") : ""}"/>
          </div>
        </div>
        <div>
          <strong style="display:block;margin-bottom:8px;font-size:13px;">Itens de Custo Padrão</strong>
          <div class="tableWrap" style="margin-bottom:10px;">
            <table class="table">
              <thead><tr>
                <th>Descrição</th><th>Categoria</th>
                <th style="text-align:right;">Qtd</th>
                <th style="text-align:right;">Custo Unit.</th>
                <th></th>
              </tr></thead>
              <tbody id="tTbody">${costRows()}</tbody>
            </table>
          </div>
          <div class="addCostGrid">
            <div class="field"><label for="ftcD">Descrição</label><input id="ftcD" class="input" type="text" maxlength="100" placeholder="Item"/></div>
            <div class="field"><label for="ftcC">Categoria</label><select id="ftcC">${CATS.map((c) => `<option>${c}</option>`).join("")}</select></div>
            <div class="field"><label for="ftcQ">Qtd</label><input id="ftcQ" class="input" type="number" min="0.01" step="0.01" value="1"/></div>
            <div class="field"><label for="ftcU">Custo Unit. (R$)</label><input id="ftcU" class="input" type="number" min="0" step="0.01" placeholder="0,00"/></div>
            <div class="field addCostBtn"><label style="visibility:hidden">a</label><button type="button" class="btn primary" id="btnTAC">+ Add</button></div>
          </div>
        </div>
      </div>
      <div class="modalFt">
        <button type="button" class="btn" id="ftCancel">Cancelar</button>
        <button type="button" class="btn primary" id="ftSave">${isEdit ? "Salvar" : "Criar Template"}</button>
      </div>`);

    const rebind = () => {
      m.querySelectorAll("[data-dtc]").forEach((btn) =>
        btn.addEventListener("click", () => {
          w.costs.splice(parseInt(btn.dataset.dtc, 10), 1);
          m.querySelector("#tTbody").innerHTML = costRows();
          rebind();
        })
      );
    };
    rebind();

    m.querySelector("#btnTAC").addEventListener("click", () => {
      const dEl = m.querySelector("#ftcD");
      const desc = dEl.value.trim();
      if (!desc) { dEl.classList.add("invalid"); return; }
      dEl.classList.remove("invalid");
      w.costs.push({
        id: uid(),
        description: desc,
        category: m.querySelector("#ftcC").value,
        qty: parseFloat(m.querySelector("#ftcQ").value) || 1,
        unitCost: parseFloat(m.querySelector("#ftcU").value) || 0,
      });
      dEl.value = ""; m.querySelector("#ftcU").value = ""; m.querySelector("#ftcQ").value = "1";
      m.querySelector("#tTbody").innerHTML = costRows();
      rebind();
    });

    m.querySelector("#ftCancel").addEventListener("click", modal.close);
    m.querySelector("#ftSave").addEventListener("click", () => {
      const nEl = m.querySelector("#ftN");
      const name = nEl.value.trim();
      if (!name) { nEl.classList.add("invalid"); nEl.focus(); return; }
      nEl.classList.remove("invalid");
      const saved = { ...w, name, description: m.querySelector("#ftD").value.trim() };
      idb.put(APP.stores.templates, saved)
        .then(() => {
          const i = state.templates.findIndex((t) => t.id === saved.id);
          if (i !== -1) state.templates[i] = saved; else state.templates.push(saved);
          toast.success(isEdit ? "Template atualizado" : "Template criado", saved.name);
          modal.close(); render();
        })
        .catch(() => toast.error("Erro ao salvar", "Não foi possível salvar template."));
    });
  }

  /* ─── Dashboard ──────────────────────────────── */
  function renderDashboard(root) {
    const active = state.jobs.filter((j) => j.status === "Active").length;
    const completed = state.jobs.filter((j) => j.status === "Completed").length;
    const invoiced = state.jobs.filter((j) => j.status === "Invoiced").length;
    const totalVal = state.jobs.reduce((s, j) => s + (j.value || 0), 0);
    const totalCosts = state.jobs.reduce((s, j) => s + jobCost(j), 0);
    const totalHrs = state.timeLogs.reduce((s, l) => s + (l.hours || 0), 0);
    const totalMargin = totalVal - totalCosts;

    const now = Date.now();
    const overdueJobs = state.jobs.filter(
      (j) => j.deadline && j.deadline < now && !["Completed", "Invoiced"].includes(j.status)
    );

    const list = state.search
      ? state.jobs.filter((j) =>
          j.name.toLowerCase().includes(state.search) ||
          (j.client || "").toLowerCase().includes(state.search))
      : sorted(state.jobs).slice(0, 8);

    root.innerHTML = `
      <div class="kpiGrid">
        <div class="card cardBody kpi">
          <div class="kpiVal">${state.jobs.length}</div>
          <div class="kpiLbl">Total de Jobs</div>
        </div>
        <div class="card cardBody kpi">
          <div class="kpiVal" style="color:var(--primary)">${active}</div>
          <div class="kpiLbl">Ativos</div>
        </div>
        <div class="card cardBody kpi">
          <div class="kpiVal" style="color:var(--ok)">${completed}</div>
          <div class="kpiLbl">Concluídos</div>
        </div>
        <div class="card cardBody kpi">
          <div class="kpiVal" style="color:var(--purple)">${invoiced}</div>
          <div class="kpiLbl">Faturados</div>
        </div>
        <div class="card cardBody kpi">
          <div class="kpiVal kpiValSm">${fmt(totalVal)}</div>
          <div class="kpiLbl">Valor Total Estimado</div>
        </div>
        <div class="card cardBody kpi">
          <div class="kpiVal kpiValSm">${fmt(totalCosts)}</div>
          <div class="kpiLbl">Total de Custos</div>
        </div>
        <div class="card cardBody kpi">
          <div class="kpiVal kpiValSm" style="color:${totalMargin >= 0 ? "var(--ok)" : "var(--danger)"}">
            ${fmt(totalMargin)}
          </div>
          <div class="kpiLbl">Margem Total</div>
        </div>
        <div class="card cardBody kpi">
          <div class="kpiVal">${totalHrs.toFixed(1)}h</div>
          <div class="kpiLbl">Horas Registradas</div>
        </div>
      </div>
      ${overdueJobs.length ? `
      <div class="alertBanner">
        ⚠ ${overdueJobs.length} job(s) com prazo vencido:
        ${overdueJobs.slice(0, 3).map((j) => `<strong>${esc(j.name)}</strong>`).join(", ")}
        ${overdueJobs.length > 3 ? `e mais ${overdueJobs.length - 3}…` : ""}
      </div>` : ""}
      <div class="card" style="margin-top:14px;">
        <div class="cardHeader">
          <div class="cardTitle">${state.search ? `Resultados: "${esc(state.search)}"` : "Jobs Recentes"}</div>
          <button class="btn primary admin-only" id="btnDN">+ Novo Job</button>
        </div>
        ${list.length === 0
          ? `<div class="empty" style="margin:14px;">${state.search ? "Nenhum job encontrado." : "Nenhum job criado ainda."}</div>`
          : list.map((j) => {
              const tc = jobCost(j);
              const margin = (j.value || 0) - tc;
              const overdue = j.deadline && j.deadline < now && !["Completed", "Invoiced"].includes(j.status);
              return `
              <div class="jobRow" data-detail="${j.id}">
                <div class="jobRowMain">
                  <strong>${esc(j.name)}</strong>
                  ${j.client ? `<span class="jobRowClient"> · ${esc(j.client)}</span>` : ""}
                  ${j.deadline ? `<span class="jobRowDeadline${overdue ? " overdue" : ""}">Prazo: ${fmtDate(j.deadline)}</span>` : ""}
                </div>
                <div class="jobRowMeta">
                  <span class="badge status-${j.status.toLowerCase()}">${j.status}</span>
                  <span class="muted" style="font-size:12px;">${fmt(j.value)}</span>
                  <span style="font-size:11px;color:${margin >= 0 ? "var(--ok)" : "var(--danger)"};">${fmt(margin)}</span>
                </div>
              </div>`;
            }).join("")}
      </div>`;

    root.querySelector("#btnDN")?.addEventListener("click", () => openJobModal(null));
    root.querySelectorAll("[data-detail]").forEach((el) =>
      el.addEventListener("click", () => {
        const j = state.jobs.find((x) => x.id === el.dataset.detail);
        if (j) openJobDetailModal(j);
      })
    );
  }

  /* ─── Jobs ───────────────────────────────────── */
  function renderJobs(root) {
    const STATUSES = ["all", "Draft", "Active", "Completed", "Invoiced"];
    let base = [...state.jobs];

    /* Search filter */
    if (state.search)
      base = base.filter((j) =>
        j.name.toLowerCase().includes(state.search) ||
        (j.client || "").toLowerCase().includes(state.search) ||
        j.status.toLowerCase().includes(state.search)
      );

    /* Status filter */
    if (state.filter !== "all") base = base.filter((j) => j.status === state.filter);

    /* Date range filter */
    if (state.dateFilter.from) base = base.filter((j) => j.date >= state.dateFilter.from);
    if (state.dateFilter.to) base = base.filter((j) => j.date <= state.dateFilter.to + 86399999);

    const list = sorted(base);
    const now = Date.now();

    const rows = list.map((j) => {
      const tc = jobCost(j);
      const margin = (j.value || 0) - tc;
      const overdue = j.deadline && j.deadline < now && !["Completed", "Invoiced"].includes(j.status);
      return `
        <tr data-detail="${j.id}">
          <td>
            <strong>${esc(j.name)}</strong>
            ${j.client ? `<br><span class="small">${esc(j.client)}</span>` : ""}
          </td>
          <td><span class="badge status-${j.status.toLowerCase()}">${j.status}</span></td>
          <td style="text-align:right;">${fmt(j.value)}</td>
          <td style="text-align:right;">${fmt(tc)}</td>
          <td style="text-align:right;color:${margin >= 0 ? "var(--ok)" : "var(--danger)"};">
            <strong>${fmt(margin)}</strong>
          </td>
          <td class="${overdue ? "deadlineCell overdue" : "deadlineCell"}">${j.deadline ? fmtDate(j.deadline) : `<span class="muted">—</span>`}</td>
          <td>${fmtDate(j.date)}</td>
          <td>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button class="btn" data-detail="${j.id}" style="padding:5px 9px;font-size:12px;">Ver</button>
              <button class="btn admin-only" data-dup="${j.id}" style="padding:5px 9px;font-size:12px;">Copiar</button>
              <button class="btn admin-only" data-edit="${j.id}" style="padding:5px 9px;font-size:12px;">Editar</button>
              <button class="btn danger admin-only" data-del="${j.id}" style="padding:5px 9px;font-size:12px;">Excluir</button>
            </div>
          </td>
        </tr>`;
    }).join("");

    root.innerHTML = `
      <div class="pageHeader">
        <h2 class="pageTitle">Pipeline de Jobs <span class="muted" style="font-size:14px;font-weight:400;">(${list.length})</span></h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn admin-only" id="btnExportAllPDF">Relatório PDF</button>
          <button class="btn primary admin-only" id="btnNJ">+ Novo Job</button>
        </div>
      </div>
      <div class="filterBar">
        ${STATUSES.map((s) => `
          <button type="button" class="filterPill${state.filter === s ? " active" : ""}" data-fv="${s}">
            ${s === "all" ? "Todos" : s}
          </button>`).join("")}
        <div class="dateFilterWrap">
          <input type="date" class="input dateFilterIn" id="dfFrom" value="${state.dateFilter.from ? fmtDateInput(state.dateFilter.from) : ""}" title="De" placeholder="De"/>
          <span class="muted" style="font-size:12px;">até</span>
          <input type="date" class="input dateFilterIn" id="dfTo" value="${state.dateFilter.to ? fmtDateInput(state.dateFilter.to) : ""}" title="Até" placeholder="Até"/>
          ${state.dateFilter.from || state.dateFilter.to ? `<button class="btn" id="btnClearDate" style="padding:4px 10px;font-size:12px;">✕</button>` : ""}
        </div>
      </div>
      ${list.length === 0
        ? `<div class="empty">${state.search || state.filter !== "all" || state.dateFilter.from || state.dateFilter.to ? "Nenhum job encontrado com os filtros aplicados." : "Nenhum job criado ainda."}</div>`
        : `<div class="tableWrap">
            <table class="table">
              <thead><tr>
                ${th("name", "Job")}
                ${th("status", "Status")}
                ${th("value", "Valor Est.", "right")}
                <th style="text-align:right;">Custo</th>
                <th style="text-align:right;">Margem</th>
                ${th("deadline", "Prazo")}
                ${th("date", "Criado")}
                <th>Ações</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`}`;

    root.querySelector("#btnNJ")?.addEventListener("click", () => openJobModal(null));
    root.querySelector("#btnExportAllPDF")?.addEventListener("click", exportAllPDF);

    root.querySelector("#dfFrom")?.addEventListener("change", (e) => {
      state.dateFilter.from = parseDate(e.target.value);
      render();
    });
    root.querySelector("#dfTo")?.addEventListener("change", (e) => {
      state.dateFilter.to = parseDate(e.target.value);
      render();
    });
    root.querySelector("#btnClearDate")?.addEventListener("click", () => {
      state.dateFilter = { from: null, to: null };
      render();
    });

    root.querySelectorAll(".filterPill").forEach((btn) =>
      btn.addEventListener("click", () => { state.filter = btn.dataset.fv; render(); })
    );
    root.querySelectorAll("th.sortable").forEach((thEl) =>
      thEl.addEventListener("click", () => {
        const col = thEl.dataset.sort;
        state.sort = state.sort.col === col
          ? { col, dir: state.sort.dir === "asc" ? "desc" : "asc" }
          : { col, dir: "asc" };
        render();
      })
    );
    root.querySelectorAll("tr[data-detail]").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const j = state.jobs.find((x) => x.id === tr.dataset.detail);
        if (j) openJobDetailModal(j);
      })
    );
    root.querySelectorAll("button[data-detail]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const j = state.jobs.find((x) => x.id === btn.dataset.detail);
        if (j) openJobDetailModal(j);
      })
    );
    root.querySelectorAll("[data-dup]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const j = state.jobs.find((x) => x.id === btn.dataset.dup);
        if (j) duplicateJob(j);
      })
    );
    root.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const j = state.jobs.find((x) => x.id === btn.dataset.edit);
        if (j) openJobModal(j);
      })
    );
    root.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const j = state.jobs.find((x) => x.id === btn.dataset.del);
        if (!j) return;
        confirm("Excluir Job", j.name, "Excluir", () => {
          idb.del(APP.stores.jobs, j.id).then(() => {
            state.jobs = state.jobs.filter((x) => x.id !== j.id);
            toast.warn("Job excluído", j.name);
            render();
          }).catch(() => toast.error("Erro", "Não foi possível excluir."));
        });
      })
    );
  }

  /* ─── Templates ──────────────────────────────── */
  function renderTemplates(root) {
    root.innerHTML = `
      <div class="pageHeader">
        <h2 class="pageTitle">Templates <span class="muted" style="font-size:14px;font-weight:400;">(${state.templates.length})</span></h2>
        <button class="btn primary admin-only" id="btnNT">+ Novo Template</button>
      </div>
      <p class="help" style="margin-bottom:16px;">Templates pré-preenchem itens de custo quando você cria um novo job.</p>
      ${state.templates.length === 0
        ? `<div class="empty">Nenhum template criado ainda.</div>`
        : `<div class="cardList">
            ${state.templates.map((t) => `
              <div class="card cardBody">
                <div class="row space" style="gap:14px;flex-wrap:wrap;">
                  <div style="min-width:0;">
                    <div class="cardTitle">${esc(t.name)}</div>
                    ${t.description ? `<div class="cardSub" style="margin-top:4px;">${esc(t.description)}</div>` : ""}
                    <div class="muted" style="font-size:12px;margin-top:6px;">
                      ${(t.costs || []).length} item(s) ·
                      Total estimado: <strong>${fmt((t.costs || []).reduce((s, c) => s + (c.qty || 0) * (c.unitCost || 0), 0))}</strong>
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;flex-shrink:0;">
                    <button class="btn admin-only" data-et="${t.id}">Editar</button>
                    <button class="btn danger admin-only" data-dt="${t.id}">Excluir</button>
                  </div>
                </div>
              </div>`).join("")}
          </div>`}`;

    root.querySelector("#btnNT")?.addEventListener("click", () => openTemplateModal(null));
    root.querySelectorAll("[data-et]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = state.templates.find((x) => x.id === btn.dataset.et);
        if (t) openTemplateModal(t);
      });
    });
    root.querySelectorAll("[data-dt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = state.templates.find((x) => x.id === btn.dataset.dt);
        if (!t) return;
        confirm("Excluir Template", t.name, "Excluir", () => {
          idb.del(APP.stores.templates, t.id).then(() => {
            state.templates = state.templates.filter((x) => x.id !== t.id);
            toast.warn("Template excluído", t.name);
            render();
          }).catch(() => toast.error("Erro", "Não foi possível excluir."));
        });
      });
    });
  }

  /* ─── Field App ──────────────────────────────── */
  function renderFieldApp(root) {
    const activeJobs = state.jobs.filter((j) => j.status === "Active");
    const jobList = activeJobs.length ? activeJobs : state.jobs;
    const opts = jobList.length
      ? jobList.map((j) => `<option value="${j.id}" ${state.fieldSession.data?.jobId === j.id ? "selected" : ""}>${esc(j.name)}</option>`).join("")
      : `<option value="">Nenhum job disponível</option>`;

    const recentLogs = [...state.timeLogs]
      .sort((a, b) => b.date - a.date)
      .slice(0, 8);

    const elapsed = state.fieldSession.active
      ? fmtDuration(Date.now() - state.fieldSession.data.timeIn)
      : "00:00:00";

    root.innerHTML = `
      <div class="fieldLayout">
        <div class="card fieldAppWrapper">
          <h2 style="margin:0;font-size:18px;">Registro de Tempo</h2>
          ${!jobList.length
            ? `<div class="empty" style="max-width:320px;">Nenhum job disponível. Peça ao administrador para criar jobs com status "Active".</div>`
            : `
              <div style="width:100%;max-width:360px;">
                <label for="fieldJobSel" style="display:block;margin-bottom:6px;font-size:12px;font-weight:600;">Job</label>
                <select id="fieldJobSel" class="input" ${state.fieldSession.active ? "disabled" : ""}>${opts}</select>
              </div>
              <button id="btnClock" type="button" class="clockBtn ${state.fieldSession.active ? "clocked-in" : ""}">
                ${state.fieldSession.active ? "CLOCK OUT" : "CLOCK IN"}
              </button>
              ${state.fieldSession.active ? `
              <div class="timerDisplay">
                <span id="liveTimer">${elapsed}</span>
                <span class="timerLabel">em andamento desde ${new Date(state.fieldSession.data.timeIn).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div style="width:100%;max-width:360px;">
                <label for="clockNote" style="display:block;margin-bottom:6px;font-size:12px;font-weight:600;">Observação ao fechar (opcional)</label>
                <input id="clockNote" class="input" type="text" maxlength="200" placeholder="O que foi feito nesta sessão…"/>
              </div>` : ""}
              <div id="geoDisplay" class="geoData">
                ${state.fieldSession.active
                  ? `📍 ${state.fieldSession.data.lat?.toFixed(5) ?? "?"}, ${state.fieldSession.data.lng?.toFixed(5) ?? "?"}`
                  : "Pronto para registrar."}
              </div>`}
        </div>
        ${recentLogs.length ? `
        <div class="card">
          <div class="cardHeader"><div class="cardTitle">Registros Recentes</div></div>
          <div class="tableWrap">
            <table class="table">
              <thead><tr><th>Job</th><th>Data</th><th style="text-align:right;">Horas</th><th>Obs.</th></tr></thead>
              <tbody>
                ${recentLogs.map((l) => {
                  const j = state.jobs.find((x) => x.id === l.jobId);
                  return `<tr>
                    <td>${j ? esc(j.name) : `<span class="muted">—</span>`}</td>
                    <td>${fmtDate(l.date)}</td>
                    <td style="text-align:right;"><strong>${(l.hours || 0).toFixed(2)}h</strong></td>
                    <td><span class="small">${l.note ? esc(l.note) : `<span class="faint">—</span>`}</span></td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>` : ""}
      </div>`;

    if (!jobList.length) return;

    /* Start live timer if already clocked in */
    if (state.fieldSession.active && !state.liveTimer) {
      state.liveTimer = setInterval(() => {
        const el = document.getElementById("liveTimer");
        if (el) {
          el.textContent = fmtDuration(Date.now() - state.fieldSession.data.timeIn);
        } else {
          clearInterval(state.liveTimer);
          state.liveTimer = null;
        }
      }, 1000);
    }

    $("#btnClock", root)?.addEventListener("click", () => {
      const geo = $("#geoDisplay", root);
      if (!state.fieldSession.active) {
        /* Clock in */
        geo.textContent = "Obtendo localização GPS…";
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            state.fieldSession.active = true;
            state.fieldSession.data = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              timeIn: Date.now(),
              jobId: $("#fieldJobSel", root).value,
            };
            /* Start timer */
            if (state.liveTimer) clearInterval(state.liveTimer);
            state.liveTimer = null;
            renderFieldApp(root);
            toast.info("Clock In registrado", `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
          },
          () => {
            /* GPS denied — clock in without coordinates */
            state.fieldSession.active = true;
            state.fieldSession.data = {
              lat: null,
              lng: null,
              timeIn: Date.now(),
              jobId: $("#fieldJobSel", root).value,
            };
            if (state.liveTimer) clearInterval(state.liveTimer);
            state.liveTimer = null;
            renderFieldApp(root);
            toast.warn("GPS não disponível", "Sessão iniciada sem coordenadas.");
          },
          { timeout: 8000 }
        );
      } else {
        /* Clock out */
        const hrs = (Date.now() - state.fieldSession.data.timeIn) / 3600000;
        const note = $("#clockNote", root)?.value.trim() || "";
        const log = {
          id: uid(),
          jobId: state.fieldSession.data.jobId,
          hours: hrs,
          date: Date.now(),
          note,
        };
        clearInterval(state.liveTimer);
        state.liveTimer = null;
        idb.put(APP.stores.timeLogs, log)
          .then(() => {
            state.timeLogs.push(log);
            state.fieldSession.active = false;
            state.fieldSession.data = null;
            toast.success("Sessão salva", `${hrs.toFixed(2)} horas registradas.`);
            renderFieldApp(root);
          })
          .catch(() => toast.error("Erro", "Não foi possível salvar o registro."));
      }
    });
  }

  /* ─── Analytics ──────────────────────────────── */
  function renderBI(root) {
    const statusCounts = state.jobs.reduce((a, j) => {
      a[j.status] = (a[j.status] || 0) + 1; return a;
    }, {});
    const topJobs = [...state.jobs].sort((a, b) => jobCost(b) - jobCost(a)).slice(0, 8);
    const hrsByJob = state.timeLogs.reduce((a, l) => {
      a[l.jobId] = (a[l.jobId] || 0) + l.hours; return a;
    }, {});

    const hasLogs = state.timeLogs.length > 0;
    const hasJobs = state.jobs.length > 0;
    const hasCosts = topJobs.some((j) => jobCost(j) > 0);
    const hasHoursEst = state.jobs.some((j) => j.estimatedHours);

    root.innerHTML = `
      <h2 class="pageTitle" style="margin-bottom:18px;">Analytics</h2>
      <div class="biGrid">
        <div class="chartWrap">
          <h3>Jobs por Status</h3>
          ${hasJobs ? `<canvas id="chartStatus"></canvas>` : `<div class="empty">Nenhum job criado ainda.</div>`}
        </div>
        <div class="chartWrap">
          <h3>Horas por Job</h3>
          ${hasLogs ? `<canvas id="chartTime"></canvas>` : `<div class="empty">Sem registros de horas ainda.</div>`}
        </div>
        ${hasCosts ? `
        <div class="chartWrap" style="grid-column:1/-1;">
          <h3>Custo Total vs. Valor Estimado</h3>
          <canvas id="chartCosts"></canvas>
        </div>` : ""}
        ${hasHoursEst ? `
        <div class="chartWrap" style="grid-column:1/-1;">
          <h3>Horas Estimadas vs. Reais por Job</h3>
          <canvas id="chartHours"></canvas>
        </div>` : ""}
      </div>`;

    setTimeout(() => {
      if (!window.Chart) return;
      const style = getComputedStyle(document.documentElement);
      const textColor = style.getPropertyValue("--text").trim() || "#e7ecf5";
      const mutedColor = style.getPropertyValue("--muted").trim() || "#aab5cc";
      const gridColor = style.getPropertyValue("--border").trim() || "rgba(255,255,255,.08)";
      Chart.defaults.color = mutedColor;
      const scaleOpts = {
        y: { beginAtZero: true, ticks: { color: mutedColor }, grid: { color: gridColor } },
        x: { ticks: { color: mutedColor }, grid: { color: gridColor } },
      };

      if (hasJobs && $("#chartStatus")) {
        new Chart($("#chartStatus"), {
          type: "doughnut",
          data: {
            labels: Object.keys(statusCounts),
            datasets: [{ data: Object.values(statusCounts), backgroundColor: ["#7f8aa3", "#7aa2ff", "#4be3a3", "#bb86fc"], borderWidth: 0 }],
          },
          options: { plugins: { legend: { position: "bottom", labels: { color: mutedColor, padding: 12 } } } },
        });
      }

      if (hasLogs && $("#chartTime")) {
        const data = {};
        Object.entries(hrsByJob).forEach(([id, hrs]) => {
          const j = state.jobs.find((x) => x.id === id);
          data[j ? j.name.slice(0, 20) : "Desconhecido"] = +hrs.toFixed(2);
        });
        new Chart($("#chartTime"), {
          type: "bar",
          data: {
            labels: Object.keys(data),
            datasets: [{ label: "Horas", data: Object.values(data), backgroundColor: "rgba(122,162,255,.75)", borderRadius: 6 }],
          },
          options: { plugins: { legend: { display: false } }, scales: scaleOpts },
        });
      }

      if (hasCosts && $("#chartCosts")) {
        new Chart($("#chartCosts"), {
          type: "bar",
          data: {
            labels: topJobs.map((j) => j.name.slice(0, 20)),
            datasets: [
              { label: "Custo Total", data: topJobs.map((j) => jobCost(j)), backgroundColor: "rgba(255,90,122,.75)", borderRadius: 5 },
              { label: "Valor Estimado", data: topJobs.map((j) => j.value || 0), backgroundColor: "rgba(122,162,255,.75)", borderRadius: 5 },
            ],
          },
          options: {
            plugins: { legend: { position: "top", labels: { color: textColor } } },
            scales: scaleOpts,
          },
        });
      }

      if (hasHoursEst && $("#chartHours")) {
        const jobsWithEst = state.jobs.filter((j) => j.estimatedHours);
        new Chart($("#chartHours"), {
          type: "bar",
          data: {
            labels: jobsWithEst.map((j) => j.name.slice(0, 20)),
            datasets: [
              {
                label: "Horas Estimadas",
                data: jobsWithEst.map((j) => j.estimatedHours),
                backgroundColor: "rgba(122,162,255,.65)",
                borderRadius: 5,
              },
              {
                label: "Horas Reais",
                data: jobsWithEst.map((j) =>
                  state.timeLogs.filter((l) => l.jobId === j.id).reduce((s, l) => s + (l.hours || 0), 0)
                ),
                backgroundColor: "rgba(75,227,163,.65)",
                borderRadius: 5,
              },
            ],
          },
          options: {
            plugins: { legend: { position: "top", labels: { color: textColor } } },
            scales: scaleOpts,
          },
        });
      }
    }, 120);
  }

  /* ─── Settings ───────────────────────────────── */
  function renderSettings(root) {
    root.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;max-width:560px;">
        <div class="card">
          <div class="cardHeader"><div class="cardTitle">Acesso e Perfil</div></div>
          <div class="cardBody" style="display:flex;flex-direction:column;gap:14px;">
            <div class="field">
              <label for="selRole">Nível de Acesso</label>
              <select id="selRole">
                <option value="admin" ${state.settings.role === "admin" ? "selected" : ""}>Administrador — acesso total</option>
                <option value="field" ${state.settings.role === "field" ? "selected" : ""}>Trabalhador de Campo — apenas Dashboard e Campo</option>
              </select>
            </div>
            <div class="field">
              <label for="selCompany">Nome da Empresa</label>
              <input id="selCompany" class="input" type="text" maxlength="100"
                placeholder="Aparece nos PDFs exportados"
                value="${esc(state.settings.company || "")}"/>
            </div>
            <button class="btn primary" id="btnSave">Salvar Configurações</button>
          </div>
        </div>

        <div class="card">
          <div class="cardHeader"><div class="cardTitle">Exportar Relatórios</div></div>
          <div class="cardBody" style="display:flex;flex-direction:column;gap:12px;">
            <div class="row" style="flex-wrap:wrap;">
              <button class="btn" id="btnSExp">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M12 3v10M8 9l4 4 4-4M5 21h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Backup JSON
              </button>
              <button class="btn" id="btnAllPDF">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M7 7h10M7 12h10M7 17h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.6"/></svg>
                Relatório Geral PDF
              </button>
              <button class="btn" id="btnSImp">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M12 21V11M8 15l4-4 4 4M5 3h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Importar Backup
              </button>
              <input type="file" id="fileImport" accept=".json" style="display:none;"/>
            </div>
            <p class="help">O backup JSON inclui jobs, horas e templates. A importação mescla os dados sem apagar registros existentes.</p>
          </div>
        </div>

        <div class="card">
          <div class="cardHeader"><div class="cardTitle">Zona de Perigo</div></div>
          <div class="cardBody" style="display:flex;flex-direction:column;gap:12px;">
            <button class="btn danger" id="btnClear">Limpar Todos os Dados</button>
            <p class="help" style="color:var(--danger);">Remove permanentemente todos os jobs, horas e templates. Exporte um backup antes!</p>
          </div>
        </div>

        <div class="card">
          <div class="cardHeader"><div class="cardTitle">Sobre o App</div></div>
          <div class="cardBody" style="display:flex;flex-direction:column;gap:6px;">
            <div><strong>JobCost Pro</strong> <span class="muted">v2.0</span></div>
            <div class="muted">Offline-first · Sem backend · Dados 100% locais (IndexedDB)</div>
            <div class="hr"></div>
            <div class="small">${state.jobs.length} jobs · ${state.timeLogs.length} registros de horas · ${state.templates.length} templates</div>
            <div class="small">Atalhos: <code class="kbd">Ctrl+K</code> busca · <code class="kbd">Ctrl+N</code> novo job · <code class="kbd">Esc</code> fechar modal</div>
          </div>
        </div>
      </div>`;

    root.querySelector("#btnSave")?.addEventListener("click", () => {
      state.settings.role = root.querySelector("#selRole").value;
      state.settings.company = root.querySelector("#selCompany").value.trim();
      ls(APP.lsKey).save(state.settings);
      document.body.setAttribute("data-role", state.settings.role);
      if (state.settings.role === "field") {
        routeTo("field");
      } else {
        toast.success("Configurações salvas", "Preferências atualizadas.");
      }
    });

    root.querySelector("#btnSExp")?.addEventListener("click", doExport);
    root.querySelector("#btnAllPDF")?.addEventListener("click", exportAllPDF);
    root.querySelector("#btnSImp")?.addEventListener("click", () =>
      root.querySelector("#fileImport").click()
    );

    root.querySelector("#fileImport")?.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!Array.isArray(data.jobs)) {
            toast.error("Importação falhou", "Formato de arquivo inválido.");
            return;
          }
          Promise.all([
            ...data.jobs.map((j) => idb.put(APP.stores.jobs, j)),
            ...(data.timeLogs || []).map((l) => idb.put(APP.stores.timeLogs, l)),
            ...(data.templates || []).map((t) => idb.put(APP.stores.templates, t)),
          ])
            .then(() => Promise.all([
              idb.getAll(APP.stores.jobs),
              idb.getAll(APP.stores.timeLogs),
              idb.getAll(APP.stores.templates),
            ]))
            .then(([jobs, tl, tpls]) => {
              state.jobs = jobs;
              state.timeLogs = tl;
              state.templates = tpls;
              toast.success("Importação concluída", `${data.jobs.length} jobs importados.`);
              render();
            })
            .catch(() => toast.error("Erro", "Falha ao salvar dados importados."));
        } catch {
          toast.error("Importação falhou", "Não foi possível ler o arquivo JSON.");
        }
      };
      reader.readAsText(file);
    });

    root.querySelector("#btnClear")?.addEventListener("click", () => {
      confirm(
        "Limpar Todos os Dados",
        "Isso excluirá TODOS os jobs, registros de horas e templates.",
        "Limpar Tudo",
        () => {
          Promise.all(
            Object.values(APP.stores).map((s) =>
              idb.getAll(s).then((items) =>
                Promise.all(items.map((item) => idb.del(s, item.id)))
              )
            )
          )
            .then(() => {
              state.jobs = [];
              state.timeLogs = [];
              state.templates = [];
              toast.warn("Dados removidos", "Todos os dados foram excluídos.");
              render();
            })
            .catch(() => toast.error("Erro", "Falha ao limpar dados."));
        }
      );
    });
  }

  init();
})();
