(function () {
  "use strict";

  var ORDERS_KEY = "blocoPedidos.pedidos";
  var PROFILE_KEY = "blocoPedidos.perfil";
  var PRODUCTS_KEY = "blocoPedidos.produtos";
  var COMMANDS_KEY = "blocoPedidos.comandas";
  var panel = null;
  var appRoot = null;
  var mutationObserver = null;
  var currentFilter = "abertas";
  var searchTerm = "";
  var previousOrdersValue = "";
  var productSignature = "";

  function readJSON(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function normalizeName(value) {
    return String(value || "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .replace(/\s+/g, " ");
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function money(value) {
    var number = Number(value) || 0;
    return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function commandList() {
    var list = readJSON(COMMANDS_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function orderList() {
    var list = readJSON(ORDERS_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function createCommand(customer, reference) {
    return {
      id: "cmd-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      cliente: customer.trim(),
      referencia: (reference || "").trim(),
      criadaEm: Date.now(),
      fechadaEm: null,
      status: "aberta",
      pedidoIds: []
    };
  }

  function isActiveOrder(order) {
    var status = normalizeName(order && order.status);
    return status !== "entregue" && status !== "cancelado" && status !== "cancelada" &&
      status !== "pago" && status !== "fechado" && status !== "fechada";
  }

  function syncCommands() {
    var commands = commandList();
    var orders = orderList();
    var linkedIds = new Set();
    var changed = false;

    commands.forEach(function (command) {
      if (!Array.isArray(command.pedidoIds)) command.pedidoIds = [];
      command.pedidoIds.forEach(function (id) { linkedIds.add(String(id)); });
      if (!command.status) command.status = command.fechadaEm ? "fechada" : "aberta";
    });

    orders.forEach(function (order) {
      if (!order || !order.id || !order.cliente || !isActiveOrder(order)) return;
      var orderId = String(order.id);
      if (linkedIds.has(orderId)) return;

      var customerKey = normalizeName(order.cliente);
      if (!customerKey) return;

      var command = commands.find(function (item) {
        return item.status === "aberta" && normalizeName(item.cliente) === customerKey;
      });
      if (!command) {
        command = createCommand(order.cliente, "");
        commands.push(command);
      }
      command.pedidoIds.push(orderId);
      linkedIds.add(orderId);
      changed = true;
    });

    if (changed || commands.some(function (item) { return !Array.isArray(item.pedidoIds); })) {
      writeJSON(COMMANDS_KEY, commands);
    }
    return commands;
  }

  function getCommandOrders(command, orders) {
    var ids = new Set((command.pedidoIds || []).map(String));
    return orders.filter(function (order) { return order && ids.has(String(order.id)); })
      .sort(function (left, right) {
        return Number(left.criadoEm || 0) - Number(right.criadoEm || 0);
      });
  }

  function orderTotal(order) {
    if (Number.isFinite(Number(order.valor))) return Number(order.valor);
    return (Array.isArray(order.itensLista) ? order.itensLista : []).reduce(function (total, item) {
      return total + (Number(item.preco) || 0) * (Number(item.qtd) || 0);
    }, 0);
  }

  function orderSummary(order) {
    if (Array.isArray(order.itensLista) && order.itensLista.length) {
      return order.itensLista.map(function (item) {
        return (Number(item.qtd) || 1) + "× " + item.nome;
      }).join(", ");
    }
    return String(order.itens || "Itens do pedido").split("\n").slice(0, 2).join(" · ");
  }

  function formatDate(timestamp) {
    if (!timestamp) return "";
    return new Date(Number(timestamp)).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function makePanel() {
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "bp-comandas-panel";
    panel.className = "bp-overlay";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "bp-panel-title");
    panel.hidden = true;
    document.body.appendChild(panel);

    panel.addEventListener("click", function (event) {
      var target = event.target.closest("[data-bp-action]");
      if (!target) {
        if (event.target === panel) closePanel();
        return;
      }
      var action = target.getAttribute("data-bp-action");
      if (action === "close") closePanel();
      if (action === "new-command") {
        var form = panel.querySelector("#bp-new-command-form");
        if (form) form.hidden = !form.hidden;
        if (form && !form.hidden) {
          var input = form.querySelector('input[name="cliente"]');
          if (input) input.focus();
        }
      }
      if (action === "filter") {
        currentFilter = target.getAttribute("data-filter") || "abertas";
        renderPanel();
      }
      if (action === "close-command") closeCommand(target.getAttribute("data-id"));
      if (action === "reopen-command") reopenCommand(target.getAttribute("data-id"));
      if (action === "backup") exportBackup();
      if (action === "restore") {
        var picker = panel.querySelector("#bp-backup-file");
        if (picker) picker.click();
      }
      if (action === "refresh") {
        syncCommands();
        renderPanel();
      }
    });

    panel.addEventListener("input", function (event) {
      if (event.target && event.target.id === "bp-search") {
        searchTerm = event.target.value;
        renderCommandCards();
      }
    });

    panel.addEventListener("submit", function (event) {
      if (!event.target || event.target.id !== "bp-new-command-form") return;
      event.preventDefault();
      var form = event.target;
      var customer = form.elements.cliente.value.trim();
      var reference = form.elements.referencia.value.trim();
      if (!customer) return;

      var commands = syncCommands();
      var existing = commands.find(function (command) {
        return command.status === "aberta" &&
          normalizeName(command.cliente) === normalizeName(customer);
      });
      if (existing) {
        if (reference && !existing.referencia) {
          existing.referencia = reference;
          writeJSON(COMMANDS_KEY, commands);
        }
        window.alert("Já existe uma comanda aberta para " + customer + ". Os próximos pedidos com esse nome serão incluídos nela.");
        renderPanel();
        return;
      }

      commands.push(createCommand(customer, reference));
      writeJSON(COMMANDS_KEY, commands);
      currentFilter = "abertas";
      renderPanel();
    });

    panel.addEventListener("change", function (event) {
      if (!event.target || event.target.id !== "bp-backup-file") return;
      importBackup(event.target.files && event.target.files[0]);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panel && !panel.hidden) closePanel();
    });

    return panel;
  }

  function readProfile() {
    return readJSON(PROFILE_KEY, {}) || {};
  }

  function renderPanel() {
    if (!panel) makePanel();
    var profile = readProfile();
    var isDark = profile.tema === "portuga";
    var brand = isDark ? "#d4af37" : (profile.cor || "#16833c");
    var logo = typeof profile.logo === "string" && /^data:image\/(png|jpeg|webp);base64,/i.test(profile.logo)
      ? profile.logo
      : "./icons/icon-192.png";
    var brandName = profile.marca || "Portuga Pedidos";

    panel.classList.toggle("bp-dark", isDark);
    panel.style.setProperty("--bp-brand", brand);
    panel.innerHTML =
      '<div class="bp-shell">' +
        '<header class="bp-header">' +
          '<div class="bp-brand-row">' +
            '<img class="bp-logo" src="' + escapeHTML(logo) + '" alt="Logo">' +
            '<div class="bp-brand-copy"><p>GESTÃO DE ATENDIMENTOS</p><h1 id="bp-panel-title">Comandas</h1><span>' + escapeHTML(brandName) + '</span></div>' +
          '</div>' +
          '<div class="bp-header-actions">' +
            '<button type="button" data-bp-action="backup" class="bp-button bp-button-quiet">Exportar backup</button>' +
            '<button type="button" data-bp-action="restore" class="bp-button bp-button-quiet">Importar backup</button>' +
            '<button type="button" data-bp-action="close" class="bp-icon-button" aria-label="Fechar comandas">×</button>' +
          '</div>' +
        '</header>' +
        '<input id="bp-backup-file" type="file" accept="application/json,.json" hidden>' +
        '<main class="bp-content">' +
          '<div class="bp-intro"><div><h2>Uma comanda por cliente</h2><p>Novos pedidos com o mesmo nome entram na comanda aberta automaticamente.</p></div>' +
          '<button type="button" data-bp-action="new-command" class="bp-button bp-button-primary">＋ Nova comanda</button></div>' +
          '<form id="bp-new-command-form" class="bp-form" hidden>' +
            '<label>Nome do cliente<input name="cliente" maxlength="80" autocomplete="name" placeholder="Ex.: Maria Silva" required></label>' +
            '<label>Mesa ou referência <span>(opcional)</span><input name="referencia" maxlength="40" placeholder="Ex.: Mesa 4"></label>' +
            '<button type="submit" class="bp-button bp-button-primary">Abrir comanda</button>' +
          '</form>' +
          '<div class="bp-toolbar"><div class="bp-filters" role="group" aria-label="Filtrar comandas">' +
            '<button type="button" data-bp-action="filter" data-filter="abertas" class="bp-filter">Abertas</button>' +
            '<button type="button" data-bp-action="filter" data-filter="fechadas" class="bp-filter">Fechadas</button>' +
          '</div><label class="bp-search"><span aria-hidden="true">⌕</span><input id="bp-search" type="search" value="' + escapeHTML(searchTerm) + '" placeholder="Buscar cliente"></label>' +
          '<button type="button" data-bp-action="refresh" class="bp-refresh">Atualizar</button></div>' +
          '<div id="bp-command-cards" class="bp-command-cards" aria-live="polite"></div>' +
          '<p class="bp-footnote">As comandas e os pedidos ficam guardados neste navegador. Use o backup para levar os dados a outro endereço ou aparelho.</p>' +
        '</main>' +
      '</div>';

    var form = panel.querySelector("#bp-new-command-form");
    if (form) form.hidden = true;
    panel.querySelectorAll("[data-filter]").forEach(function (button) {
      var active = button.getAttribute("data-filter") === currentFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    renderCommandCards();
  }

  function renderCommandCards() {
    if (!panel || panel.hidden) return;
    var host = panel.querySelector("#bp-command-cards");
    if (!host) return;

    var commands = syncCommands();
    var orders = orderList();
    var filtered = commands.filter(function (command) {
      var status = command.status || (command.fechadaEm ? "fechada" : "aberta");
      if (currentFilter === "abertas" && status !== "aberta") return false;
      if (currentFilter === "fechadas" && status !== "fechada") return false;
      var query = normalizeName(searchTerm);
      return !query || normalizeName(command.cliente + " " + command.referencia).includes(query);
    }).sort(function (left, right) {
      var leftTime = Number(left.fechadaEm || left.criadaEm || 0);
      var rightTime = Number(right.fechadaEm || right.criadaEm || 0);
      return rightTime - leftTime;
    });

    if (!filtered.length) {
      host.innerHTML = '<div class="bp-empty"><span aria-hidden="true">🧾</span><h3>' +
        (currentFilter === "abertas" ? "Nenhuma comanda aberta" : "Nenhuma comanda fechada") +
        '</h3><p>' + (currentFilter === "abertas"
          ? "Abra uma comanda para um cliente ou registre um pedido. Pedidos com o mesmo nome serão agrupados."
          : "As comandas fechadas aparecerão aqui.") +
        '</p></div>';
      return;
    }

    host.innerHTML = filtered.map(function (command, index) {
      var tickets = getCommandOrders(command, orders);
      var total = tickets.reduce(function (sum, order) { return sum + orderTotal(order); }, 0);
      var number = String(index + 1).padStart(3, "0");
      var status = command.status || (command.fechadaEm ? "fechada" : "aberta");
      var lastTicket = tickets.reduce(function (latest, order) {
        return Math.max(latest, Number(order.criadoEm || 0));
      }, Number(command.criadaEm || 0));
      var rows = tickets.map(function (order) {
        var orderCode = String(order.id || "").slice(-5).toUpperCase();
        var orderStatus = order.status || "pendente";
        return '<li class="bp-ticket"><div><strong>Pedido #' + escapeHTML(orderCode) + '</strong><p>' +
          escapeHTML(orderSummary(order)) + '</p><small>' + escapeHTML(orderStatus) + ' · ' +
          escapeHTML(formatDate(order.criadoEm)) + '</small></div><b>' + money(orderTotal(order)) + '</b></li>';
      }).join("");
      return '<article class="bp-command-card">' +
        '<div class="bp-command-top"><div><span class="bp-command-number">COMANDA ' + number + '</span>' +
        '<h3>' + escapeHTML(command.cliente) + '</h3>' +
        (command.referencia ? '<span class="bp-reference">' + escapeHTML(command.referencia) + '</span>' : '') +
        '</div><span class="bp-status ' + (status === "aberta" ? "is-open" : "is-closed") + '">' +
        (status === "aberta" ? "Aberta" : "Fechada") + '</span></div>' +
        '<div class="bp-command-total"><div><strong>' + money(total) + '</strong><span>' +
        tickets.length + (tickets.length === 1 ? " pedido" : " pedidos") + ' · Atualizada ' +
        escapeHTML(formatDate(lastTicket)) + '</span></div></div>' +
        (rows ? '<details class="bp-details"><summary>Ver pedidos e itens</summary><ul>' + rows + '</ul></details>' :
          '<p class="bp-waiting">Comanda aberta, aguardando o primeiro pedido.</p>') +
        '<div class="bp-card-actions">' +
        (status === "aberta"
          ? '<button type="button" class="bp-button bp-button-close" data-bp-action="close-command" data-id="' + escapeHTML(command.id) + '">Fechar conta</button>'
          : '<button type="button" class="bp-button bp-button-quiet" data-bp-action="reopen-command" data-id="' + escapeHTML(command.id) + '">Reabrir comanda</button>') +
        '</div></article>';
    }).join("");
  }

  function closeCommand(id) {
    var commands = commandList();
    var command = commands.find(function (item) { return item.id === id; });
    if (!command) return;
    command.status = "fechada";
    command.fechadaEm = Date.now();
    writeJSON(COMMANDS_KEY, commands);
    currentFilter = "fechadas";
    renderPanel();
  }

  function reopenCommand(id) {
    var commands = commandList();
    var command = commands.find(function (item) { return item.id === id; });
    if (!command) return;
    var alreadyOpen = commands.find(function (item) {
      return item.id !== id && item.status === "aberta" &&
        normalizeName(item.cliente) === normalizeName(command.cliente);
    });
    if (alreadyOpen) {
      window.alert("Já existe outra comanda aberta para " + command.cliente + ".");
      return;
    }
    command.status = "aberta";
    command.fechadaEm = null;
    writeJSON(COMMANDS_KEY, commands);
    currentFilter = "abertas";
    renderPanel();
  }

  function exportBackup() {
    var data = {};
    [PROFILE_KEY, ORDERS_KEY, PRODUCTS_KEY, COMMANDS_KEY].forEach(function (key) {
      var value = localStorage.getItem(key);
      if (value !== null) data[key] = JSON.parse(value);
    });
    var file = new Blob([JSON.stringify({
      app: "Portuga Pedidos",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: data
    }, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(file);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "backup-portuga-pedidos.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function importBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var backup = JSON.parse(String(reader.result || ""));
        if (!backup || backup.app !== "Portuga Pedidos" || !backup.data || typeof backup.data !== "object") {
          throw new Error("Arquivo de backup não reconhecido.");
        }
        if (!window.confirm("Importar este backup vai substituir logo, tema, produtos, pedidos e comandas guardados neste navegador. Deseja continuar?")) return;
        [PROFILE_KEY, ORDERS_KEY, PRODUCTS_KEY, COMMANDS_KEY].forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(backup.data, key)) {
            localStorage.setItem(key, JSON.stringify(backup.data[key]));
          }
        });
        window.location.reload();
      } catch (error) {
        window.alert(error && error.message ? error.message : "Não foi possível ler esse arquivo.");
      }
    };
    reader.readAsText(file);
  }

  function openPanel() {
    makePanel();
    currentFilter = "abertas";
    searchTerm = "";
    syncCommands();
    renderPanel();
    panel.hidden = false;
    document.body.classList.add("bp-panel-open");
    ensureNavButton();
    var close = panel.querySelector('[data-bp-action="close"]');
    if (close) close.focus();
  }

  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    document.body.classList.remove("bp-panel-open");
    var button = document.getElementById("bp-nav-comandas");
    if (button) button.classList.remove("bp-nav-active");
  }

  function ensureNavButton() {
    if (!appRoot) appRoot = document.getElementById("app-root");
    if (!appRoot) return;
    var nav = appRoot.querySelector('nav[aria-label="Navegação principal"]');
    if (!nav) return;

    nav.style.gridTemplateColumns = "repeat(5, minmax(0, 1fr))";
    var button = nav.querySelector("#bp-nav-comandas");
    if (!button) {
      button = document.createElement("button");
      button.id = "bp-nav-comandas";
      button.type = "button";
      button.className = "bp-nav-button";
      button.setAttribute("aria-label", "Comandas");
      button.innerHTML = '<span aria-hidden="true">🧾</span><span>Comandas</span>';
      button.addEventListener("click", openPanel);
      nav.appendChild(button);
    }
    button.classList.toggle("bp-nav-active", !!(panel && !panel.hidden));
  }

  function enhanceCategoryColumns() {
    if (!appRoot) return;
    appRoot.querySelectorAll('section[aria-label^="Categoria "]').forEach(function (section) {
      var parent = section.parentElement;
      if (parent && parent.className && String(parent.className).indexOf("space-y-5") >= 0) {
        parent.classList.add("bp-category-columns");
      }
    });
  }

  function nativeSetValue(element, value) {
    var prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function enhanceOrderPicker() {
    if (!appRoot) return;
    var labels = appRoot.querySelectorAll("p");
    var title = Array.from(labels).find(function (element) {
      return element.textContent.trim() === "ADICIONAR DO CATÁLOGO";
    });
    if (!title) {
      productSignature = "";
      return;
    }

    var block = title.parentElement;
    var controls = block && block.querySelector(".flex.gap-2");
    var select = controls && controls.querySelector("select");
    if (!select) return;

    var groups = Array.from(select.querySelectorAll("optgroup")).map(function (group) {
      return {
        label: group.label,
        items: Array.from(group.querySelectorAll("option")).filter(function (option) {
          return option.value;
        }).map(function (option) {
          return { id: option.value, label: option.textContent.trim() };
        })
      };
    }).filter(function (group) { return group.items.length; });
    var signature = JSON.stringify(groups);
    var grid = block.querySelector(".bp-menu-columns");
    if (signature === productSignature && grid) return;
    productSignature = signature;

    if (!grid) {
      grid = document.createElement("div");
      grid.className = "bp-menu-columns";
      grid.setAttribute("aria-label", "Cardápio separado por categoria");
      block.appendChild(grid);
    }

    controls.style.display = "none";
    if (!groups.length) {
      grid.innerHTML = '<p class="bp-menu-empty">Cadastre produtos na aba Produtos para montar o cardápio por categoria.</p>';
      return;
    }

    grid.innerHTML = groups.map(function (group) {
      var items = group.items.map(function (item) {
        return '<button type="button" class="bp-menu-product" data-product-id="' + escapeHTML(item.id) +
          '" aria-label="Adicionar ' + escapeHTML(item.label) + ' ao pedido"><span>' +
          escapeHTML(item.label.replace(/\s+—\s+R\$\s*[\d.,]+$/i, "")) + '</span><b>＋</b></button>';
      }).join("");
      return '<section class="bp-menu-category"><h3>' + escapeHTML(group.label) + '</h3><div>' + items + '</div></section>';
    }).join("");

    grid.querySelectorAll("[data-product-id]").forEach(function (productButton) {
      productButton.addEventListener("click", function () {
        var currentSelect = block.querySelector("select");
        var addButton = controls.querySelector("button");
        var optionId = productButton.getAttribute("data-product-id");
        if (!currentSelect || !addButton) return;
        nativeSetValue(currentSelect, optionId);
        currentSelect.dispatchEvent(new Event("change", { bubbles: true }));
        window.setTimeout(function () { addButton.click(); }, 80);
      });
    });
  }

  function installStyles() {
    if (document.getElementById("bp-enhancement-styles")) return;
    var style = document.createElement("style");
    style.id = "bp-enhancement-styles";
    style.textContent =
      "#app-root button{min-height:42px;touch-action:manipulation;transition:transform .15s ease,filter .15s ease,box-shadow .15s ease}" +
      "#app-root button:active{transform:scale(.98)}" +
      "#app-root button:focus-visible{outline:3px solid color-mix(in srgb,var(--brand,#16833c) 45%,transparent);outline-offset:2px}" +
      "#app-root button.btn-brand{min-height:46px;font-weight:800;box-shadow:0 4px 12px rgba(0,0,0,.12)}" +
      "#app-root nav[aria-label='Navegação principal']>button{min-width:0;min-height:54px;padding:6px 2px!important;font-size:clamp(9px,2.8vw,12px);line-height:1.15;flex-direction:column;gap:3px}" +
      ".bp-nav-button{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:3px;min-width:0;min-height:54px;padding:5px 2px;border:0;border-radius:12px;background:transparent;color:#737373;font-size:clamp(9px,2.8vw,12px);font-weight:800;line-height:1.15}" +
      ".bp-nav-button span:first-child{font-size:17px}" +
      ".bp-nav-button.bp-nav-active{background:var(--brand,#16833c);color:#fff}" +
      ".bp-category-columns{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px!important}" +
      ".bp-category-columns>*{margin-top:0!important;min-width:0}" +
      "@media(max-width:379px){.bp-category-columns{grid-template-columns:1fr}}" +
      ".bp-overlay[hidden]{display:none!important}body.bp-panel-open{overflow:hidden}" +
      ".bp-overlay{position:fixed;inset:0;z-index:1000;overflow:auto;background:#f5f5f4;color:#171717;font-family:inherit;--bp-brand:#16833c;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}" +
      ".bp-shell{max-width:920px;min-height:100%;margin:0 auto;background:#f5f5f4}" +
      ".bp-dark,.bp-dark .bp-shell{background:#120d07;color:#f8eed6}" +
      ".bp-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px max(16px,env(safe-area-inset-left));background:var(--bp-brand);color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.16)}" +
      ".bp-dark .bp-header{background:linear-gradient(125deg,#271b0e,#100b07);border-bottom:1px solid rgba(212,175,55,.3)}" +
      ".bp-brand-row{display:flex;align-items:center;gap:11px;min-width:0}.bp-logo{width:44px;height:44px;border-radius:12px;object-fit:contain;background:#fff;padding:2px;flex-shrink:0}" +
      ".bp-brand-copy{min-width:0}.bp-brand-copy p{font-size:9px;font-weight:900;letter-spacing:.14em;opacity:.78;margin:0}.bp-brand-copy h1{font-size:22px;line-height:1.1;font-weight:900;margin:3px 0}.bp-brand-copy span{font-size:11px;opacity:.85;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".bp-header-actions{display:flex;align-items:center;gap:6px}.bp-button,.bp-icon-button,.bp-refresh{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:12px;min-height:42px;padding:9px 13px;font:inherit;font-weight:800;cursor:pointer;touch-action:manipulation}" +
      ".bp-button-quiet,.bp-refresh{background:rgba(255,255,255,.16);color:inherit}.bp-header .bp-button-quiet{font-size:11px;min-height:34px;padding:7px 9px}.bp-icon-button{width:38px;padding:0;font-size:26px;background:rgba(255,255,255,.16);color:inherit}" +
      ".bp-content{padding:20px 16px 32px}.bp-intro{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.bp-intro h2{font-size:20px;font-weight:900;margin:0 0 4px}.bp-intro p{font-size:13px;line-height:1.4;color:#666;margin:0;max-width:540px}.bp-dark .bp-intro p{color:#c3b58e}" +
      ".bp-button-primary{background:var(--bp-brand);color:#fff;box-shadow:0 5px 14px color-mix(in srgb,var(--bp-brand) 28%,transparent);white-space:nowrap}.bp-dark .bp-button-primary{color:#231903}" +
      ".bp-form{display:grid;grid-template-columns:1fr 1fr auto;align-items:end;gap:10px;padding:14px;margin:0 0 16px;border:1px solid #e5e5e5;border-radius:18px;background:#fff}.bp-dark .bp-form,.bp-dark .bp-command-card{background:#1e1510;border-color:rgba(212,175,55,.28)}.bp-form[hidden]{display:none}.bp-form label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:800}.bp-form label span{font-weight:500;color:#737373}.bp-form input,.bp-search input{min-width:0;width:100%;min-height:42px;padding:10px 11px;border:1px solid #d4d4d4;border-radius:11px;background:#fff;color:#171717;font:inherit;font-size:14px}.bp-dark .bp-form input,.bp-dark .bp-search input{background:#251a11;color:#f8eed6;border-color:rgba(212,175,55,.35)}" +
      ".bp-toolbar{display:flex;align-items:center;gap:10px;margin:14px 0}.bp-filters{display:flex;gap:4px;padding:4px;border-radius:12px;background:#e7e5e4}.bp-dark .bp-filters{background:#251a11}.bp-filter{border:0;border-radius:9px;padding:8px 12px;background:transparent;color:#737373;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.bp-filter.is-active{background:#fff;color:#171717;box-shadow:0 1px 4px rgba(0,0,0,.12)}.bp-dark .bp-filter.is-active{background:#d4af37;color:#231903}.bp-search{display:flex;align-items:center;gap:7px;flex:1;min-width:100px;padding-left:10px;border-radius:12px;background:#fff;border:1px solid #e5e5e5;color:#737373}.bp-dark .bp-search{background:#251a11;border-color:rgba(212,175,55,.28)}.bp-search input{border:0;background:transparent;outline:none}.bp-refresh{background:#e7e5e4;color:#444;font-size:12px}.bp-dark .bp-refresh{background:#251a11;color:#ecdcb6}" +
      ".bp-command-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.bp-command-card{min-width:0;padding:15px;border:1px solid #e5e5e5;border-radius:18px;background:#fff;box-shadow:0 5px 18px rgba(0,0,0,.045)}.bp-command-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.bp-command-number{font-size:9px;letter-spacing:.13em;font-weight:900;color:var(--bp-brand)}.bp-command-top h3{font-size:17px;font-weight:900;margin:3px 0 0;overflow-wrap:anywhere}.bp-reference{display:inline-block;margin-top:4px;font-size:11px;color:#737373}.bp-status{flex-shrink:0;border-radius:99px;padding:5px 8px;font-size:10px;font-weight:900}.bp-status.is-open{background:#dcfce7;color:#166534}.bp-status.is-closed{background:#e7e5e4;color:#57534e}.bp-dark .bp-status.is-open{background:#26432c;color:#b7efbd}.bp-dark .bp-status.is-closed{background:#37291d;color:#e6d3a7}" +
      ".bp-command-total{display:flex;justify-content:space-between;align-items:flex-end;margin:12px 0 5px;padding-top:10px;border-top:1px solid #eee}.bp-dark .bp-command-total{border-color:rgba(212,175,55,.2)}.bp-command-total strong{display:block;font-size:21px;font-weight:950}.bp-command-total span{display:block;margin-top:2px;color:#737373;font-size:11px}.bp-dark .bp-command-total span{color:#c3b58e}.bp-details{margin:10px 0}.bp-details summary{cursor:pointer;color:var(--bp-brand);font-size:12px;font-weight:900}.bp-details ul{list-style:none;margin:8px 0 0;padding:0}.bp-ticket{display:flex;justify-content:space-between;gap:9px;padding:9px 0;border-top:1px solid #eee}.bp-dark .bp-ticket{border-color:rgba(212,175,55,.18)}.bp-ticket strong{font-size:11px}.bp-ticket p{margin:3px 0;font-size:11px;line-height:1.35;overflow-wrap:anywhere}.bp-ticket small{font-size:10px;color:#737373}.bp-ticket>b{flex-shrink:0;font-size:11px}.bp-waiting{font-size:11px;color:#737373;margin:12px 0}.bp-card-actions{display:flex;justify-content:flex-end;margin-top:10px}.bp-button-close{background:#fee2e2;color:#991b1b;font-size:12px}.bp-dark .bp-button-close{background:#4b2117;color:#ffd3bc}.bp-empty{grid-column:1/-1;padding:38px 18px;text-align:center;border:1px dashed #d6d3d1;border-radius:18px}.bp-empty>span{font-size:32px}.bp-empty h3{font-size:16px;font-weight:900;margin:8px 0 3px}.bp-empty p{max-width:420px;margin:0 auto;color:#737373;font-size:13px;line-height:1.5}.bp-dark .bp-empty{border-color:rgba(212,175,55,.35)}.bp-dark .bp-empty p{color:#c3b58e}.bp-footnote{margin:18px 0 0;color:#78716c;font-size:11px;line-height:1.45}.bp-dark .bp-footnote{color:#aa986f}" +
      ".bp-menu-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.bp-menu-category{min-width:0;padding:10px;border:1px solid #e5e5e5;border-radius:14px;background:rgba(255,255,255,.72)}.theme-portuga .bp-menu-category{background:#251a11;border-color:rgba(212,175,55,.28)}.bp-menu-category h3{margin:0 0 7px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:950;color:var(--brand,#16833c)}.bp-menu-category>div{display:grid;grid-template-columns:1fr;gap:6px}.bp-menu-product{display:flex;align-items:center;justify-content:space-between;gap:5px;min-width:0;min-height:38px!important;padding:7px 8px;border:1px solid #e7e5e4!important;border-radius:10px;background:#fff;color:#292524;text-align:left;font:inherit;font-size:11px;font-weight:750;cursor:pointer}.theme-portuga .bp-menu-product{background:#1e1510;color:#f8eed6;border-color:rgba(212,175,55,.28)!important}.bp-menu-product span{overflow-wrap:anywhere}.bp-menu-product b{flex-shrink:0;color:var(--brand,#16833c);font-size:16px}.bp-menu-empty{grid-column:1/-1;margin:0;padding:10px;border-radius:12px;background:#f5f5f4;color:#737373;font-size:12px}" +
      "@media(max-width:600px){.bp-header{align-items:flex-start}.bp-header-actions{flex-wrap:wrap;justify-content:flex-end}.bp-header .bp-button-quiet{font-size:10px;padding:6px}.bp-content{padding:16px 12px 26px}.bp-intro{align-items:flex-start;flex-direction:column}.bp-form{grid-template-columns:1fr}.bp-toolbar{flex-wrap:wrap}.bp-filters{flex-shrink:0}.bp-refresh{min-height:38px}.bp-command-cards{grid-template-columns:1fr}.bp-menu-columns{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
      "@media(max-width:359px){.bp-menu-columns{grid-template-columns:1fr}.bp-brand-copy span{max-width:115px}}";
    document.head.appendChild(style);
  }

  function enhanceApp() {
    if (!appRoot) appRoot = document.getElementById("app-root");
    if (!appRoot) return;
    ensureNavButton();
    enhanceCategoryColumns();
    enhanceOrderPicker();
  }

  function boot() {
    installStyles();
    syncCommands();
    previousOrdersValue = localStorage.getItem(ORDERS_KEY) || "[]";

    var attempts = 0;
    var waitForApp = window.setInterval(function () {
      attempts += 1;
      appRoot = document.getElementById("app-root");
      if (appRoot) {
        window.clearInterval(waitForApp);
        enhanceApp();
        mutationObserver = new MutationObserver(function () {
          window.requestAnimationFrame(enhanceApp);
        });
        mutationObserver.observe(appRoot, { childList: true, subtree: true });
      } else if (attempts > 100) {
        window.clearInterval(waitForApp);
      }
    }, 100);

    window.setInterval(function () {
      var current = localStorage.getItem(ORDERS_KEY) || "[]";
      if (current !== previousOrdersValue) {
        previousOrdersValue = current;
        syncCommands();
        if (panel && !panel.hidden) renderPanel();
      }
    }, 900);

    window.addEventListener("storage", function (event) {
      if (event.key === ORDERS_KEY || event.key === PROFILE_KEY) {
        syncCommands();
        if (panel && !panel.hidden) renderPanel();
        enhanceApp();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
