/**
 * ============================================================
 * KONNECT — Petty Cash ERP | script.js
 * Versión: 3.0 — IGV & SUNAT Ready
 * ============================================================
 *
 * BUGS CORREGIDOS EN ESTA VERSIÓN:
 * 1. saveGeneralTransaction() guardaba movimientos sin el campo `category`,
 *    lo que rompía todo el filtrado posterior (historial, estado de uso, arqueo).
 * 2. renderArqueo() filtraba por `m.category` pero los movimientos guardados
 *    no tenían ese campo → arqueo siempre vacío.
 * 3. viewHistory() mostraba columnas genéricas (Descripción, Monto) pero el
 *    modelo guardaba campos ricos (tipoDoc, serie, correlativo, concepto,
 *    pagadoA) que nunca se pintaban.
 * 4. validateVoucherRealTime() no distinguía entre voucher inexistente y
 *    voucher ya usado (reembolsado).
 * 5. Estado de Uso en sucursales usaba m.category === '102.01' pero el campo
 *    nunca se guardaba → barra siempre en 0.
 * 6. toggleUserSelector() usaba onclick en lugar de onchange — corregido en HTML.
 * 7. Los `alert()` / `confirm()` nativos reemplazados por sistema propio.
 * 8. Modal-crud no tenía campos minT / maxT → siempre se guardaba 40/70 hardcoded.
 * 9. Fecha del formulario no se inicializaba dinámicamente (estaba hardcoded en HTML).
 * 10. renderCategoriasEnGastos() no limpiaba campos al cambiar categoría.
 * ============================================================
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// 1. CUENTAS FIJAS DE SISTEMA (no editables por el usuario)
// ─────────────────────────────────────────────────────────────
const CUENTAS_FIJAS = [
    { id: '102.01', name: 'Ingreso Caja Chica',  type: 'INGRESO', fixed: true, afectaArqueo: false },
    { id: '602.01', name: 'Reembolso Caja Chica', type: 'EGRESO',  fixed: true, afectaArqueo: true  }
];

// ─────────────────────────────────────────────────────────────
// 2. BASE DE DATOS EN MEMORIA (respaldada en localStorage)
// ─────────────────────────────────────────────────────────────
let db = (() => {
    try {
        const stored = localStorage.getItem('konnect_data_v2');
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.warn('localStorage corrupto, reiniciando db.', e);
        return null;
    }
})() || {
    agencies: [
        {
            id: 1,
            name: 'Agencia Santiago',
            fund: 1000,
            minT: 40,
            maxT: 70,
            cajaChicaActiva: true,
            movements: []   // Estructura de cada movimiento:
                            // { id, date, category, type, tipoDoc, serie,
                            //   correlativo, concepto, pagadoA, amount,
                            //   obs, voucherId }
        }
    ],
    chartOfAccounts: [
        { id: '601.01', name: 'Combustible',        type: 'EGRESO',  fixed: false },
        { id: '601.02', name: 'Útiles de Oficina',  type: 'EGRESO',  fixed: false }
    ]
};

/** ID de la caja/sucursal activa según el selector del header */
let activeAgencyId = db.agencies[0]?.id ?? 1;

/** Persiste la base de datos en localStorage */
const saveToLocalStorage = () => {
    try {
        localStorage.setItem('konnect_data_v2', JSON.stringify(db));
    } catch (e) {
        showToast('Error al guardar en localStorage: ' + e.message, 'error');
    }
};

// ─────────────────────────────────────────────────────────────
// 3. SISTEMA DE NOTIFICACIONES (reemplaza alert / confirm)
// ─────────────────────────────────────────────────────────────

/**
 * Muestra un toast flotante no bloqueante.
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {number} duration ms
 */
window.showToast = function(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { success: '✔', error: '✕', warning: '⚠', info: 'ℹ' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span> ${message}`;

    container.appendChild(toast);
    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('toast-show'));

    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 350);
    }, duration);
};

/**
 * Diálogo de confirmación no bloqueante (reemplaza confirm()).
 * @param {string} title
 * @param {string} message
 * @param {Function} onConfirm callback si acepta
 */
window.showConfirm = function(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const dialog = document.getElementById('confirm-dialog');
    dialog.style.display = 'flex';

    const btn = document.getElementById('confirm-ok-btn');
    // Clonar para limpiar listeners previos
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.onclick = () => {
        closeModal('confirm-dialog');
        onConfirm();
    };
};

// ─────────────────────────────────────────────────────────────
// 4. NAVEGACIÓN SPA
// ─────────────────────────────────────────────────────────────

/**
 * Muestra la sección solicitada y oculta las demás.
 * @param {string} id  ID del <section>
 * @param {Element|null} navItem  <li> clickeado para marcar activo
 */
window.showSection = function(id, navItem) {
    document.querySelectorAll('.view').forEach(s => s.style.display = 'none');
    const target = document.getElementById(id);
    if (target) target.style.display = 'block';

    // Actualizar estado activo en sidebar
    document.querySelectorAll('.nav-item').forEach(li => li.classList.remove('active'));
    if (navItem) navItem.classList.add('active');
    else {
        // Buscar por data-section
        const match = document.querySelector(`.nav-item[data-section="${id}"]`);
        if (match) match.classList.add('active');
    }

    // Render específico por sección
    if (id === 'view-admin-global')    window.renderSucursales();
    if (id === 'view-plan-cuentas')    window.renderCuentas();
    if (id === 'view-gastos-ingresos') window.initGastosForm();
    if (id === 'view-arqueo')          window.renderArqueo();
    if (id === 'view-vouchers')        window.renderVouchersPendientes();
};

// ─────────────────────────────────────────────────────────────
// 5. GESTIÓN DE SUCURSALES / CAJAS
// ─────────────────────────────────────────────────────────────

/**
 * Renderiza la tabla principal de sucursales con estado de deuda actualizado.
 * LÓGICA CORREGIDA:
 *   - La deuda pendiente = suma de movimientos con category === '102.01'
 *     que NO tienen voucherId asignado.
 *   - El estado de uso = (deudaPendiente / fondo) * 100
 */
window.renderSucursales = function() {
    const tbody = document.getElementById('tbody-sucursales');
    if (!tbody) return;

    tbody.innerHTML = db.agencies.map(a => {
        const deudaPendiente = calcDeudaPendiente(a);
        const percent        = a.fund > 0 ? (deudaPendiente / a.fund) * 100 : 0;
        const barColor = percent >= a.maxT
            ? 'var(--danger)'
            : percent >= a.minT
                ? 'var(--warning)'
                : 'var(--success)';

        const activa = a.cajaChicaActiva !== false; // default true si no existe

        return `
        <tr class="row-hover ${activa ? '' : 'row-inactiva'}" ondblclick="viewHistory(${a.id})" title="Doble clic para ver historial">
            <td>
                <strong>${escHtml(a.name)}</strong>
                <div class="agency-id">ID: ${a.id}</div>
            </td>
            <td><span class="amount-cell">$${a.fund.toLocaleString('es-CL')}</span></td>
            <td>
                <div class="usage-info">
                    <div class="usage-header">
                        <small class="amount-owed">$${deudaPendiente.toLocaleString('es-CL')} adeudado</small>
                        <small class="pct-label">${percent.toFixed(1)}%</small>
                    </div>
                    <div class="progress-bg">
                        <div class="progress-bar" style="width:${Math.min(percent, 100)}%; background:${barColor}"></div>
                    </div>
                </div>
            </td>
            <td>${a.minT}%</td>
            <td>${a.maxT}%</td>
            <td>
                <div class="estatus-cell" onclick="event.stopPropagation()">
                    <label class="toggle-switch toggle-sm">
                        <input type="checkbox" ${activa ? 'checked' : ''}
                            onchange="toggleCajaChica(${a.id}, this.checked)">
                        <span class="toggle-track">
                            <span class="toggle-thumb"></span>
                        </span>
                    </label>
                    <span class="estatus-label ${activa ? 'estatus-on' : 'estatus-off'}">
                        ${activa ? 'Activa' : 'Inactiva'}
                    </span>
                </div>
            </td>
            <td class="actions-cell">
                <button class="btn-sm btn-primary"
                    onclick="event.stopPropagation(); editAgency(${a.id})">Editar</button>
                <button class="btn-sm btn-outline"
                    onclick="event.stopPropagation(); viewHistory(${a.id})">Historial</button>
            </td>
        </tr>`;
    }).join('');
};

/**
 * Calcula la deuda pendiente (ingresos registrados sin reembolso) de una agencia.
 * @param {Object} agency
 * @returns {number}
 */
function calcDeudaPendiente(agency) {
    return agency.movements
        .filter(m => m.category === '102.01' && !m.voucherId)
        .reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);
}

/** Abre el modal para crear una nueva caja */
window.openCreateModal = function() {
    document.getElementById('edit-id').value = '';
    document.getElementById('input-name').value = '';
    document.getElementById('input-fund').value = '';
    document.getElementById('input-min').value  = 40;
    document.getElementById('input-max').value  = 70;
    document.getElementById('input-activa').checked = true;
    window.updateToggleLabel();
    document.getElementById('modal-title').textContent = 'Nueva Caja Chica';
    document.getElementById('modal-crud').style.display = 'flex';
};

/** Carga datos existentes al modal de edición */
window.editAgency = function(id) {
    const a = db.agencies.find(a => a.id == id);
    if (!a) return;
    const activa = a.cajaChicaActiva !== false;
    document.getElementById('edit-id').value        = a.id;
    document.getElementById('input-name').value     = a.name;
    document.getElementById('input-fund').value     = a.fund;
    document.getElementById('input-min').value      = a.minT;
    document.getElementById('input-max').value      = a.maxT;
    document.getElementById('input-activa').checked = activa;
    window.updateToggleLabel();
    document.getElementById('modal-title').textContent = 'Editar Caja: ' + a.name;
    document.getElementById('modal-crud').style.display = 'flex';
};

/** Guarda (crea o actualiza) una caja/sucursal */
window.saveAgency = function() {
    const id   = document.getElementById('edit-id').value;
    const name = document.getElementById('input-name').value.trim();
    const fund = parseFloat(document.getElementById('input-fund').value);
    const minT = parseInt(document.getElementById('input-min').value);
    const maxT = parseInt(document.getElementById('input-max').value);

    if (!name)          return showToast('El nombre es obligatorio.', 'warning');
    if (isNaN(fund) || fund <= 0) return showToast('El fondo debe ser mayor a 0.', 'warning');
    if (isNaN(minT) || isNaN(maxT)) return showToast('Ingrese los porcentajes de alerta.', 'warning');
    if (minT >= maxT)   return showToast('El mínimo debe ser menor al máximo.', 'warning');

    const cajaChicaActiva = document.getElementById('input-activa').checked;

    if (id) {
        const idx = db.agencies.findIndex(a => a.id == id);
        if (idx !== -1) Object.assign(db.agencies[idx], { name, fund, minT, maxT, cajaChicaActiva });
    } else {
        db.agencies.push({ id: Date.now(), name, fund, minT, maxT, cajaChicaActiva, movements: [] });
    }

    saveToLocalStorage();
    window.updateUserSelector();
    window.closeModal('modal-crud');
    window.renderSucursales();
    showToast(id ? 'Caja actualizada correctamente.' : 'Nueva caja creada.', 'success');
};

// ─────────────────────────────────────────────────────────────
// 6. PLAN DE CUENTAS
// ─────────────────────────────────────────────────────────────

/** Renderiza la tabla de cuentas (fijas + personalizadas). */
window.renderCuentas = function() {
    const tbody = document.getElementById('tbody-cuentas');
    if (!tbody) return;

    const query  = (document.getElementById('search-cuentas')?.value || '').toLowerCase();
    const todas  = [...CUENTAS_FIJAS, ...db.chartOfAccounts.filter(x => !x.fixed)];
    const filtradas = query
        ? todas.filter(c => c.id.toLowerCase().includes(query) || c.name.toLowerCase().includes(query))
        : todas;

    const countEl = document.getElementById('cuentas-count');
    if (countEl) countEl.textContent = `${filtradas.length} cuentas`;

    tbody.innerHTML = filtradas.length
        ? filtradas.map(acc => `
            <tr class="row-hover">
                <td><code>${escHtml(acc.id)}</code></td>
                <td>
                    ${escHtml(acc.name)}
                    ${acc.fixed ? '<span class="badge-fixed">SISTEMA</span>' : ''}
                </td>
                <td>
                    <span class="badge-type badge-${acc.type.toLowerCase()}">${acc.type}</span>
                </td>
                <td class="amount-cell">
                    ${acc.fixed ? '—' : (typeof acc.tasaIGVDefault === 'number' ? `${acc.tasaIGVDefault}%` : '18%')}
                </td>
                <td>
                    ${acc.fixed
                        ? '<span class="text-muted">—</span>'
                        : `<button class="btn-sm btn-danger" onclick="deleteAccount('${escHtml(acc.id)}')">Eliminar</button>`
                    }
                </td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="empty-row">Sin cuentas que coincidan.</td></tr>';
};

/** Filtra la tabla de cuentas en tiempo real */
window.filterCuentas = function() {
    window.renderCuentas();
};

/** Abre el modal de nueva cuenta */
window.openAccountModal = function() {
    document.getElementById('acc-code').value     = '';
    document.getElementById('acc-name').value     = '';
    document.getElementById('acc-type').value     = 'EGRESO';
    document.getElementById('acc-igv').value      = '18';
    document.getElementById('modal-cuenta').style.display = 'flex';
};

/** Guarda una cuenta nueva */
window.saveAccount = function() {
    const id   = document.getElementById('acc-code').value.trim();
    const name = document.getElementById('acc-name').value.trim();
    const type = document.getElementById('acc-type').value;
    const igv  = parseInt(document.getElementById('acc-igv').value);

    if (!id)   return showToast('El código contable es obligatorio.', 'warning');
    if (!name) return showToast('El nombre de la cuenta es obligatorio.', 'warning');
    if (isNaN(igv) || igv < 0 || igv > 100)
        return showToast('La tasa IGV debe ser un número entre 0 y 100.', 'warning');

    const allAccounts = [...CUENTAS_FIJAS, ...db.chartOfAccounts];
    if (allAccounts.find(a => a.id === id)) {
        return showToast(`El código ${id} ya existe.`, 'error');
    }

    db.chartOfAccounts.push({ id, name, type, fixed: false, tasaIGVDefault: igv });
    saveToLocalStorage();
    window.closeModal('modal-cuenta');
    window.renderCuentas();
    showToast('Cuenta creada correctamente.', 'success');
};

/** Elimina una cuenta con confirmación */
window.deleteAccount = function(id) {
    const cuenta = db.chartOfAccounts.find(a => a.id === id);
    if (!cuenta) return;

    // Verificar que no esté en uso
    const enUso = db.agencies.some(ag =>
        ag.movements.some(m => m.category === id)
    );

    if (enUso) {
        return showToast(`La cuenta ${id} tiene movimientos asociados y no puede eliminarse.`, 'error');
    }

    showConfirm(
        '¿Eliminar cuenta?',
        `Se eliminará permanentemente la cuenta "${cuenta.name}" (${id}).`,
        () => {
            db.chartOfAccounts = db.chartOfAccounts.filter(a => a.id !== id);
            saveToLocalStorage();
            window.renderCuentas();
            showToast('Cuenta eliminada.', 'success');
        }
    );
};

// ─────────────────────────────────────────────────────────────
// 7. FORMULARIO DE GASTOS E INGRESOS
// ─────────────────────────────────────────────────────────────

/** Inicializa el formulario con fecha de hoy y categorías correctas */
window.initGastosForm = function() {
    // Fecha por defecto = hoy
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('gi-fecha').value = today;

    // Poblar selector "otra caja"
    const selectOtro = document.getElementById('gi-usuario-otro');
    selectOtro.innerHTML = db.agencies
        .map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`)
        .join('');

    window.renderCategoriasEnGastos();
};

/** Puebla el select de categorías según el tipo de transacción.
 *  Si la caja activa tiene cajaChicaActiva === false, oculta 102.01 y 602.01.
 */
window.renderCategoriasEnGastos = function() {
    const select = document.getElementById('gi-categoria');
    if (!select) return;

    const tipo    = document.getElementById('gi-tipo-trans').value;
    const agencia = db.agencies.find(a => a.id === activeAgencyId);
    const ccActiva = agencia ? agencia.cajaChicaActiva !== false : true;

    // Banner de aviso si la caja chica está desactivada
    const banner = document.getElementById('cc-inactiva-banner');
    if (banner) banner.style.display = ccActiva ? 'none' : 'flex';

    const filtradas = [...CUENTAS_FIJAS, ...db.chartOfAccounts]
        .filter(x => x.type === tipo)
        .filter(x => {
            // Si la caja chica está inactiva, excluir las cuentas de control
            if (!ccActiva && (x.id === '102.01' || x.id === '602.01')) return false;
            return true;
        });

    if (filtradas.length === 0) {
        select.innerHTML = '<option value="">— Sin categorías disponibles —</option>';
        window.handleCategoryChange();
        return;
    }

    select.innerHTML = filtradas
        .map(x => `<option value="${x.id}">${x.id} — ${escHtml(x.name)}</option>`)
        .join('');

    window.handleCategoryChange();
};

/**
 * Controla la visibilidad de bloques dinámicos según la categoría elegida:
 *   102.01 → Bloque de comprobante (ingreso)
 *   602.01 → Bloque de voucher (reembolso, monto bloqueado)
 *   Otro   → Sin bloques extra
 */
window.handleCategoryChange = function() {
    const val          = document.getElementById('gi-categoria').value;
    const montoInput   = document.getElementById('gi-monto');
    const pagadoARow   = document.getElementById('pagado-a-container');

    const showIngreso   = val === '102.01';
    const showReemb     = val === '602.01';
    const showEgresoDoc = !showIngreso && !showReemb && val !== '';

    document.getElementById('dynamic-fields-container').style.display  = showIngreso   ? 'block' : 'none';
    document.getElementById('voucher-input-container').style.display   = showReemb     ? 'block' : 'none';
    document.getElementById('egreso-doc-container').style.display      = showEgresoDoc ? 'block' : 'none';

    // Pre-cargar tasa IGV default de la categoría seleccionada
    const allAccounts = [...CUENTAS_FIJAS, ...db.chartOfAccounts];
    const cuenta = allAccounts.find(c => c.id === val);
    const igvInput = document.getElementById('gi-igv-tasa');
    if (igvInput && cuenta && typeof cuenta.tasaIGVDefault === 'number') {
        igvInput.value = cuenta.tasaIGVDefault;
    } else if (igvInput) {
        igvInput.value = 18; // default razonable
    }
    // Ocultar bloque IGV hasta que el usuario seleccione tipoDoc = FACTURA
    const igvBlock = document.getElementById('igv-block');
    if (igvBlock) igvBlock.style.display = 'none';
    recalcularIGV();

    montoInput.readOnly = showReemb;
    montoInput.style.background = showReemb ? '#f0f0f0' : '';
    montoInput.value = showReemb ? '' : montoInput.value;

    if (pagadoARow) pagadoARow.style.display = showIngreso ? 'none' : 'flex';

    const vStatus = document.getElementById('voucher-status');
    if (vStatus) { vStatus.textContent = ''; vStatus.className = 'voucher-status'; }
};

/**
 * Valida el voucher en tiempo real para el formulario de Reembolso (602.01).
 *
 * CICLO DE ESTADOS:
 *   1. No encontrado      → rojo    — el voucher no existe en ninguna caja
 *   2. Pendiente de pago  → verde   — voucher generado, aún no liquidado por cajero
 *   3. Ya liquidado       → naranja — ya existe un movimiento 602.01 con este voucher
 */
window.validateVoucherRealTime = function() {
    const folio    = document.getElementById('gi-voucher-ref').value.trim();
    const montoEl  = document.getElementById('gi-monto');
    const statusEl = document.getElementById('voucher-status');

    if (!folio) {
        statusEl.textContent = '';
        statusEl.className   = 'voucher-status';
        montoEl.value        = '';
        return;
    }

    let totalVoucher = 0;
    let encontrado   = false;
    let yaLiquidado  = false; // existe un 602.01 con este voucherId → ciclo cerrado

    db.agencies.forEach(a => {
        a.movements.forEach(m => {
            if (m.voucherId === folio) {
                encontrado = true;
                if (m.category === '102.01') {
                    // Ingresos agrupados bajo esta orden de pago
                    totalVoucher += parseFloat(m.amount || 0);
                }
                if (m.category === '602.01') {
                    // El cajero ya registró el egreso → ciclo cerrado
                    yaLiquidado = true;
                }
            }
        });
    });

    if (!encontrado) {
        statusEl.textContent = '✕ Voucher no encontrado';
        statusEl.className   = 'voucher-status voucher-invalid';
        montoEl.value        = '';
    } else if (yaLiquidado) {
        statusEl.textContent = '⚠ Este voucher ya fue liquidado';
        statusEl.className   = 'voucher-status voucher-warn';
        montoEl.value        = ''; // no permitir doble pago
    } else {
        // Voucher válido y pendiente de pago → habilitar
        statusEl.textContent = `✔ Pendiente de pago — $${totalVoucher.toLocaleString('es-CL')}`;
        statusEl.className   = 'voucher-status voucher-valid';
        montoEl.value        = totalVoucher > 0 ? totalVoucher : '';
    }
};

// ─────────────────────────────────────────────────────────────
// 7b. IGV Y SUNAT
// ─────────────────────────────────────────────────────────────

/**
 * Muestra u oculta el bloque IGV según el tipo de documento seleccionado.
 * Solo visible cuando tipoDoc = FACTURA.
 * Se llama desde onchange en cualquier selector de tipoDoc.
 */
window.onTipoDocChange = function(selectEl) {
    const igvBlock = document.getElementById('igv-block');
    if (!igvBlock) return;
    const esFactura = selectEl.value === 'FACTURA';
    igvBlock.style.display = esFactura ? 'block' : 'none';
    if (!esFactura) {
        // Limpiar campos calculados si no es factura
        const base = document.getElementById('gi-igv-base');
        const monto = document.getElementById('gi-igv-monto');
        if (base)  base.value = '';
        if (monto) monto.value = '';
    } else {
        recalcularIGV();
    }
};

/**
 * Recalcula Base Imponible e IGV en tiempo real.
 * Base = Total / (1 + tasa/100)
 * IGV  = Total − Base
 */
window.recalcularIGV = function() {
    const igvBlock = document.getElementById('igv-block');
    if (!igvBlock || igvBlock.style.display === 'none') return;

    const total = parseFloat(document.getElementById('gi-monto')?.value || 0);
    const tasa  = parseInt(document.getElementById('gi-igv-tasa')?.value || 0);
    const baseEl  = document.getElementById('gi-igv-base');
    const montoEl = document.getElementById('gi-igv-monto');

    if (!baseEl || !montoEl) return;

    if (isNaN(total) || total <= 0 || isNaN(tasa) || tasa < 0) {
        baseEl.value  = '';
        montoEl.value = '';
        return;
    }

    const base = total / (1 + tasa / 100);
    const igv  = total - base;
    baseEl.value  = base.toFixed(2);
    montoEl.value = igv.toFixed(2);
};

/**
 * Stub de integración con SUNAT API.
 * En producción: fetch real al endpoint de consulta RUC.
 * Aquí simula la respuesta con un pequeño delay.
 */
window.lookupRUC = async function(inputEl) {
    const ruc = inputEl.value.trim();
    const statusEl = document.getElementById('ruc-status');
    const razonEl  = document.getElementById('gi-razon-social');
    if (!statusEl || !razonEl) return;

    if (ruc.length !== 11 || !/^\d{11}$/.test(ruc)) {
        statusEl.textContent = '';
        statusEl.className = 'ruc-status';
        razonEl.value = '';
        razonEl.readOnly = false;
        return;
    }

    statusEl.textContent = '⏳ Consultando SUNAT…';
    statusEl.className = 'ruc-status ruc-loading';
    razonEl.value = '';
    razonEl.readOnly = true;

    try {
        // ── STUB: reemplazar por fetch real en producción ──
        // const res  = await fetch(`/api/sunat/ruc/${ruc}`);
        // const data = await res.json();
        await new Promise(r => setTimeout(r, 600)); // simula latencia
        const mockData = {
            '20100113610': { razonSocial: 'ALICORP S.A.A.', activo: true },
            '20131312955': { razonSocial: 'SAGA FALABELLA S.A.', activo: true },
        };
        const data = mockData[ruc] || null;
        // ──────────────────────────────────────────────────

        if (!data) {
            statusEl.textContent = '✕ RUC no encontrado';
            statusEl.className = 'ruc-status ruc-invalid';
            razonEl.readOnly = false;
        } else if (!data.activo) {
            statusEl.textContent = '⚠ Contribuyente inactivo';
            statusEl.className = 'ruc-status ruc-warn';
            razonEl.value    = data.razonSocial;
            razonEl.readOnly = false;
        } else {
            statusEl.textContent = '✔ Encontrado';
            statusEl.className = 'ruc-status ruc-valid';
            razonEl.value    = data.razonSocial;
            razonEl.readOnly = true;
        }
    } catch (e) {
        statusEl.textContent = '⚠ Error al consultar SUNAT';
        statusEl.className = 'ruc-status ruc-warn';
        razonEl.readOnly = false;
    }
};


window.saveGeneralTransaction = function() {
    const esOtraCaja = document.getElementById('ref-otro').checked;
    const targetId   = esOtraCaja
        ? parseInt(document.getElementById('gi-usuario-otro').value)
        : activeAgencyId;

    const agencia = db.agencies.find(a => a.id === targetId);
    const cat     = document.getElementById('gi-categoria').value;
    const monto   = parseFloat(document.getElementById('gi-monto').value);
    const fecha   = document.getElementById('gi-fecha').value;

    if (!agencia) return showToast('Caja destino no encontrada.', 'error');
    if (!fecha)   return showToast('La fecha es obligatoria.', 'warning');
    if (isNaN(monto) || monto <= 0) return showToast('Ingrese un monto válido mayor a 0.', 'warning');

    // Determinar afectaArqueo desde el catálogo
    const allAccounts  = [...CUENTAS_FIJAS, ...db.chartOfAccounts];
    const cuentaDef    = allAccounts.find(c => c.id === cat);
    const afectaArqueo = cuentaDef ? (cuentaDef.afectaArqueo !== false) : true;

    const mov = {
        id:           Date.now(),
        date:         fecha,
        category:     cat,
        type:         cat === '102.01' ? 'INGRESO' : 'EGRESO',
        afectaArqueo,
        amount:       monto,
        obs:          document.getElementById('gi-obs').value.trim()
    };

    if (cat === '102.01') {
        const tipoDoc   = document.getElementById('gi-tipo-doc').value;
        const serie     = document.getElementById('gi-serie').value.trim();
        const correl    = document.getElementById('gi-correlativo').value.trim();
        const concepto  = document.getElementById('gi-concepto').value.trim();
        const pagadoA   = document.getElementById('gi-pagado-a-ingreso').value.trim();
        const ruc       = document.getElementById('gi-ruc-emisor')?.value.trim() || '';
        const razon     = document.getElementById('gi-razon-social')?.value.trim() || '';

        if (!concepto) return showToast('El concepto es obligatorio.', 'warning');
        if (!pagadoA)  return showToast('El campo "Pagado a" es obligatorio.', 'warning');

        Object.assign(mov, { tipoDoc, serie, correlativo: correl, concepto, pagadoA,
                              rucEmisor: ruc, razonSocialEmisor: razon, voucherId: null });

    } else if (cat === '602.01') {
        const folio    = document.getElementById('gi-voucher-ref').value.trim();
        const statusEl = document.getElementById('voucher-status');

        if (!folio) return showToast('Ingrese el N° de Voucher para el reembolso.', 'warning');
        if (statusEl.classList.contains('voucher-invalid'))
            return showToast('El voucher ingresado no existe.', 'error');
        if (statusEl.classList.contains('voucher-warn'))
            return showToast('El voucher ya fue reembolsado anteriormente.', 'error');

        // Marcar todos los 102.01 de ese voucher como liquidados
        db.agencies.forEach(ag => {
            ag.movements.forEach(m => {
                if (m.voucherId === folio && m.category === '102.01') {
                    m.liquidado = true;
                    m.fechaReembolso = fecha;
                }
            });
        });

        Object.assign(mov, { voucherId: folio, concepto: 'Reembolso de caja chica', pagadoA: '' });

    } else {
        const tipoDoc  = document.getElementById('gi-egreso-tipo-doc').value;
        const serie    = document.getElementById('gi-egreso-serie').value.trim();
        const correl   = document.getElementById('gi-egreso-correlativo').value.trim();
        const concepto = document.getElementById('gi-egreso-concepto').value.trim();
        const pagadoA  = document.getElementById('gi-pagado-a').value.trim();

        if (!pagadoA)  return showToast('El campo "Pagado a" es obligatorio.', 'warning');
        if (!correl)   return showToast('El N° de documento es obligatorio en todo egreso.', 'warning');
        if (!concepto) return showToast('El concepto es obligatorio.', 'warning');

        Object.assign(mov, { tipoDoc, serie, correlativo: correl, concepto, pagadoA });
    }

    // IGV — solo cuando tipoDoc = FACTURA y el bloque está visible
    const igvBlock = document.getElementById('igv-block');
    if (igvBlock && igvBlock.style.display !== 'none') {
        const tasa = parseInt(document.getElementById('gi-igv-tasa')?.value || 0);
        const base = parseFloat(document.getElementById('gi-igv-base')?.value || 0);
        const igv  = parseFloat(document.getElementById('gi-igv-monto')?.value || 0);
        if (!isNaN(tasa)) {
            mov.tasaIGV  = tasa;
            mov.montoBase = parseFloat(base.toFixed(2));
            mov.montoIGV  = parseFloat(igv.toFixed(2));
            mov.montoTotal = monto;
        }
    }

    // Centro de costo (opcional)
    const cc = document.getElementById('gi-centro-costo')?.value.trim();
    if (cc) mov.centroCosto = cc;

    agencia.movements.push(mov);
    saveToLocalStorage();
    showToast('Transacción registrada correctamente.', 'success');
    resetGastosForm();
    window.showSection('view-admin-global', null);
    window.updateVoucherBadge();
};

/** Limpia el formulario de gastos tras guardar */
function resetGastosForm() {
    ['gi-concepto', 'gi-serie', 'gi-correlativo', 'gi-obs',
     'gi-pagado-a', 'gi-pagado-a-ingreso', 'gi-voucher-ref', 'gi-monto',
     'gi-egreso-serie', 'gi-egreso-correlativo', 'gi-egreso-concepto',
     'gi-centro-costo', 'gi-ruc-emisor', 'gi-razon-social',
     'gi-igv-tasa', 'gi-igv-base', 'gi-igv-monto']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    const rucStatus = document.getElementById('ruc-status');
    if (rucStatus) { rucStatus.textContent = ''; rucStatus.className = 'ruc-status'; }

    document.getElementById('gi-tipo-trans').value = 'EGRESO';
    document.getElementById('ref-propio').checked  = true;
    document.getElementById('user-selector-container').style.display = 'none';
    document.getElementById('egreso-doc-container').style.display    = 'none';
    const igvBlock = document.getElementById('igv-block');
    if (igvBlock) igvBlock.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────
// 8. HISTORIAL Y REEMBOLSO
// ─────────────────────────────────────────────────────────────

/**
 * Abre el modal de historial de una caja.
 * CORRECCIÓN: Pinta todos los campos ricos del movimiento
 * (tipoDoc, serie/correlativo, concepto, pagadoA).
 */
window.viewHistory = function(id) {
    const a = db.agencies.find(x => x.id == id);
    if (!a) return;

    document.getElementById('history-agency-name').textContent = a.name;

    const movCC = a.movements.filter(m =>
        m.category === '102.01' || m.category === '602.01'
    );

    const deudaTotal = movCC
        .filter(m => m.category === '102.01' && !m.voucherId && m.estado !== 'ANULADO')
        .reduce((s, m) => s + parseFloat(m.amount || 0), 0);

    const tbody = document.getElementById('tbody-history');

    tbody.innerHTML = movCC.length
        ? movCC.map(m => {
            const esIngreso = m.category === '102.01';
            const esAnulado = m.estado === 'ANULADO';
            const rowClass  = esAnulado ? 'row-anulado' : (esIngreso ? '' : 'row-reembolso');
            const docNum    = (m.serie && m.correlativo) ? `${m.serie}–${m.correlativo}` : (m.correlativo || '—');

            // Estado del voucher con fecha de reembolso
            let voucherCell = '';
            if (esAnulado) {
                voucherCell = `<span class="badge-type badge-anulado" style="font-size:10px;">—</span>`;
            } else if (esIngreso && !m.voucherId) {
                voucherCell = `<input type="checkbox" class="chk-reem"
                    data-idx="${a.movements.indexOf(m)}"
                    data-amount="${m.amount}"
                    onchange="updateTotalSelected()">`;
            } else if (esIngreso && m.voucherId && !m.liquidado) {
                voucherCell = `<span class="badge-voucher" style="background:var(--warning);color:#fff;">${escHtml(m.voucherId)}</span>
                               <span class="badge-pending">Pendiente</span>`;
            } else if (esIngreso && m.voucherId && m.liquidado) {
                const fechaR = m.fechaReembolso ? `<br><small class="text-muted">Reembolsado: ${m.fechaReembolso}</small>` : '';
                voucherCell = `<span class="badge-voucher badge-voucher-ok">${escHtml(m.voucherId)}</span>${fechaR}`;
            } else if (!esIngreso && m.voucherId) {
                voucherCell = `<span class="badge-voucher badge-voucher-ok">${escHtml(m.voucherId)}</span>`;
            } else {
                voucherCell = '—';
            }

            // IGV columns (solo para FACTURA)
            const esFactura   = m.tipoDoc === 'FACTURA';
            const baseDisplay = esFactura && m.montoBase  != null ? `$${parseFloat(m.montoBase).toLocaleString('es-CL')}` : '—';
            const igvDisplay  = esFactura && m.montoIGV   != null ? `$${parseFloat(m.montoIGV).toLocaleString('es-CL')}` : '—';
            const tasaDisplay = esFactura && m.tasaIGV    != null ? `${m.tasaIGV}%` : '—';

            const montoDisplay = `$${parseFloat(m.amount || 0).toLocaleString('es-CL')}`;

            return `
            <tr class="row-hover ${rowClass}">
                <td><small>${m.date || '—'}</small></td>
                <td>
                    ${esAnulado
                        ? `<span class="badge-type badge-anulado">ANULADO</span>`
                        : esIngreso
                            ? `<span class="badge-type badge-ingreso">${m.tipoDoc || 'INGRESO'}</span>`
                            : `<span class="badge-type badge-egreso">REEMBOLSO</span>`
                    }
                </td>
                <td><code>${docNum}</code></td>
                <td class="col-ruc">
                    ${escHtml(m.rucEmisor || '—')}
                    ${m.razonSocialEmisor ? `<br><small class="text-muted">${escHtml(m.razonSocialEmisor)}</small>` : ''}
                </td>
                <td>
                    ${escHtml(m.concepto || m.obs || '—')}
                    ${esAnulado ? `<br><small class="text-anulado">Motivo: ${escHtml(m.motivoAnulacion || '—')}</small>` : ''}
                </td>
                <td class="amount-cell">${tasaDisplay}</td>
                <td class="amount-cell">${baseDisplay}</td>
                <td class="amount-cell">${igvDisplay}</td>
                <td class="amount-cell ${esAnulado ? 'text-anulado' : ''}">
                    ${esAnulado ? `<s>${montoDisplay}</s>` : montoDisplay}
                </td>
                <td>${voucherCell}</td>
                <td>
                    ${esAnulado
                        ? '<span class="text-muted" style="font-size:11px;">Anulado</span>'
                        : `<button class="btn-sm btn-anular" onclick="abrirModalAnular(${id}, ${m.id})">Anular</button>`
                    }
                </td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="11" class="empty-row">Sin movimientos de caja chica registrados.</td></tr>';

    document.querySelector('.modal-buttons-history').innerHTML = `
        <div class="history-footer-info">
            <span>Deuda pendiente:</span>
            <strong class="amount-danger">$${deudaTotal.toLocaleString('es-CL')}</strong>
            <span style="margin-left:10px;">Monto a reembolsar:</span>
            <input type="number" id="manual-reem-amount" value="0" class="reem-amount-input" readonly>
        </div>
        <div class="history-footer-actions">
            <button class="btn-confirm" onclick="procesarReembolso(${id})">Generar Voucher</button>
            <button class="btn-cancel" onclick="closeModal('modal-history')">Cerrar</button>
        </div>
    `;

    document.getElementById('modal-history').style.display = 'flex';
};



/** Actualiza el campo de total cuando se marcan/desmarcan checkboxes */
window.updateTotalSelected = function() {
    let total = 0;
    document.querySelectorAll('.chk-reem:checked').forEach(c => {
        total += parseFloat(c.dataset.amount || 0);
    });
    const el = document.getElementById('manual-reem-amount');
    if (el) el.value = total;
};

/**
 * CICLO DE CAJA CHICA — PASO 1/2: Generar Orden de Pago (Voucher)
 *
 * Este paso SOLO agrupa los ingresos seleccionados bajo un N° de voucher
 * y los marca con estado "PENDIENTE DE PAGO". NO registra ningún egreso.
 *
 * El ciclo se CIERRA en el PASO 2/2, cuando el cajero va a
 * Gastos e Ingresos → selecciona "Reembolso Caja Chica (602.01)"
 * → ingresa este N° de voucher → registra el egreso real de caja.
 *
 * Estados del movimiento 102.01:
 *   voucherId = null               → Pendiente (sin orden de pago)
 *   voucherId = "VOU-XXXXX"        → Con orden de pago generada, esperando pago
 *   liquidado = true               → Pagado (ciclo cerrado por movimiento 602.01)
 */
window.procesarReembolso = function(agencyId) {
    const a        = db.agencies.find(x => x.id == agencyId);
    const selected = document.querySelectorAll('.chk-reem:checked');

    if (selected.length === 0) {
        return showToast('Seleccione al menos un ingreso para generar la orden.', 'warning');
    }

    const vId   = 'VOU-' + String(Math.floor(Math.random() * 90000 + 10000));
    let   total = 0;

    // Solo asignar el voucherId como "orden de pago pendiente"
    // NO se crea ningún movimiento 602.01 aquí.
    selected.forEach(chk => {
        const idx = parseInt(chk.dataset.idx);
        a.movements[idx].voucherId  = vId;
        a.movements[idx].liquidado  = false; // pendiente de pago por cajero
        total += parseFloat(chk.dataset.amount || 0);
    });

    saveToLocalStorage();

    // Mostrar panel de orden de pago generada
    showVoucherPanel(vId, total, agencyId);
};

/**
 * Muestra el panel de confirmación con instrucciones para el cajero.
 * @param {string} vId   N° de voucher generado
 * @param {number} total Monto total a reembolsar
 * @param {number} agencyId
 */
function showVoucherPanel(vId, total, agencyId) {
    // Reemplazar footer del modal con la orden de pago
    document.querySelector('.modal-buttons-history').innerHTML = `
        <div class="voucher-generated-panel">
            <div class="voucher-panel-header">
                <span class="voucher-panel-icon">📋</span>
                <div>
                    <div class="voucher-panel-title">Orden de Pago Generada</div>
                    <div class="voucher-panel-subtitle">El cajero debe registrar el egreso para cerrar el ciclo</div>
                </div>
            </div>
            <div class="voucher-panel-body">
                <div class="voucher-detail-row">
                    <span class="voucher-detail-label">N° Voucher</span>
                    <span class="badge-voucher voucher-lg">${escHtml(vId)}</span>
                </div>
                <div class="voucher-detail-row">
                    <span class="voucher-detail-label">Monto a Pagar</span>
                    <span class="voucher-detail-value amount-danger">$${total.toLocaleString('es-CL')}</span>
                </div>
            </div>
            <div class="voucher-panel-instructions">
                <strong>Instrucción para el Cajero:</strong>
                Ir a <em>Gastos e Ingresos</em> → Tipo: <strong>Egreso</strong> →
                Categoría: <strong>Reembolso Caja Chica (602.01)</strong> →
                Ingresar el N° Voucher <code>${escHtml(vId)}</code> para cerrar el ciclo.
            </div>
            <div class="voucher-panel-actions">
                <button class="btn-confirm" onclick="closeModal('modal-history'); window.renderSucursales();">Entendido</button>
                <button class="btn-outline" onclick="window.viewHistory(${agencyId})">Ver Historial</button>
            </div>
        </div>
    `;
}

// ─────────────────────────────────────────────────────────────
// 9. ARQUEO DE CAJA
// ─────────────────────────────────────────────────────────────

/**
 * Renderiza el arqueo de caja completo por la caja activa.
 *
 * REGLA DE NEGOCIO:
 *   - viewHistory  → solo 102.01 y 602.01  (ciclo de caja chica)
 *   - renderArqueo → TODOS los movimientos  (liquidación completa del cajero)
 *
 * Lógica de impacto:
 *   - type === 'INGRESO' → suma al saldo  (+)
 *   - type === 'EGRESO'  → resta al saldo (−)
 */
window.renderArqueo = function() {
    const agencia = db.agencies.find(a => a.id === activeAgencyId);
    if (!agencia) return;

    const selectorText = document.getElementById('header-user-selector')?.selectedOptions[0]?.text || '—';
    document.getElementById('arqueo-user-label').textContent = selectorText;

    const tbody          = document.getElementById('tbody-arqueo');
    const ventaBase      = 5000; // Placeholder apertura de turno
    let   egresosTotales = 0;
    let   ingresosExtra  = 0;

    // Catálogo completo para resolver nombres de cuenta
    const allAccounts = [...CUENTAS_FIJAS, ...db.chartOfAccounts];

    // ── Solo movimientos que afectan el arqueo del cajero ──
    // 102.01 (afectaArqueo: false) NO aparece — no toca la caja de ventas.
    // 602.01 (afectaArqueo: true)  SÍ aparece — sale de la caja de ventas.
    const todosMovimientos = agencia.movements.filter(m => {
        if (m.estado === 'ANULADO') return false;
        const cuenta = allAccounts.find(c => c.id === m.category);
        if (cuenta && cuenta.afectaArqueo === false) return false;
        return true;
    });
    const getNombreCuenta = (catId) => {
        const cuenta = allAccounts.find(c => c.id === catId);
        return cuenta ? cuenta.name : catId;
    };

    // Fila de apertura de turno
    tbody.innerHTML = `
        <tr>
            <td><small>—</small></td>
            <td><span class="badge-type badge-ingreso">APERTURA</span></td>
            <td>Apertura de turno</td>
            <td>—</td>
            <td class="amount-cell">$${ventaBase.toLocaleString('es-CL')}</td>
            <td class="impact-positive">+ $${ventaBase.toLocaleString('es-CL')}</td>
        </tr>
    `;

    if (todosMovimientos.length === 0) {
        tbody.innerHTML += `
            <tr>
                <td colspan="6" class="empty-row">Sin movimientos registrados en este turno.</td>
            </tr>
        `;
    }

    todosMovimientos.forEach(m => {
        const esEgreso = m.type === 'EGRESO';
        const monto    = parseFloat(m.amount || 0);

        if (esEgreso) egresosTotales += monto;
        else          ingresosExtra  += monto;

        // Referencia: priorizar serie-correlativo, luego voucher, luego concepto
        const ref = (m.serie && m.correlativo)
            ? `${escHtml(m.serie)}–${escHtml(m.correlativo)}`
            : m.voucherId
                ? escHtml(m.voucherId)
                : '—';

        const nombreCuenta = getNombreCuenta(m.category);
        const badgeClass   = esEgreso ? 'badge-egreso' : 'badge-ingreso';

        tbody.innerHTML += `
            <tr class="row-hover">
                <td><small>${m.date || '—'}</small></td>
                <td>
                    <span class="badge-type ${badgeClass}" title="${escHtml(m.category)}">
                        ${escHtml(nombreCuenta)}
                    </span>
                </td>
                <td>
                    ${ref}
                    ${m.concepto ? `<br><small class="text-muted">${escHtml(m.concepto)}</small>` : ''}
                </td>
                <td>${escHtml(m.pagadoA || '—')}</td>
                <td class="amount-cell">$${monto.toLocaleString('es-CL')}</td>
                <td class="${esEgreso ? 'impact-negative' : 'impact-positive'}">
                    ${esEgreso ? '−' : '+'} $${monto.toLocaleString('es-CL')}
                </td>
            </tr>
        `;
    });

    const saldoFinal = ventaBase - egresosTotales + ingresosExtra;

    // Stat cards
    document.getElementById('arq-ventas').textContent  = `$${(ventaBase + ingresosExtra).toLocaleString('es-CL')}`;
    document.getElementById('arq-egresos').textContent = `-$${egresosTotales.toLocaleString('es-CL')}`;
    document.getElementById('arq-saldo').textContent   = `$${saldoFinal.toLocaleString('es-CL')}`;
};

// ─────────────────────────────────────────────────────────────
// 9b. ANULACIÓN DE MOVIMIENTOS
// ─────────────────────────────────────────────────────────────

/**
 * Abre el modal de anulación mostrando el resumen del movimiento a anular.
 * Solo se puede anular si el movimiento NO está ya anulado y
 * si no tiene voucherId con estado liquidado (ya cobrado).
 */
window.abrirModalAnular = function(agencyId, movId) {
    const a   = db.agencies.find(x => x.id == agencyId);
    const mov = a?.movements.find(m => m.id == movId);
    if (!mov) return showToast('Movimiento no encontrado.', 'error');

    if (mov.estado === 'ANULADO') {
        return showToast('Este movimiento ya está anulado.', 'warning');
    }
    if (mov.liquidado) {
        return showToast('No se puede anular un movimiento ya liquidado.', 'error');
    }

    // Llenar el resumen informativo del modal
    const docNum = (mov.serie && mov.correlativo)
        ? `${mov.serie}–${mov.correlativo}`
        : (mov.correlativo || mov.voucherId || '—');

    document.getElementById('anular-mov-info').innerHTML = `
        <div class="anular-info-grid">
            <div><span class="info-label">Fecha</span><span>${mov.date || '—'}</span></div>
            <div><span class="info-label">Categoría</span><span>${mov.category}</span></div>
            <div><span class="info-label">Documento</span><span>${escHtml(docNum)}</span></div>
            <div><span class="info-label">Concepto</span><span>${escHtml(mov.concepto || '—')}</span></div>
            <div><span class="info-label">Pagado a</span><span>${escHtml(mov.pagadoA || '—')}</span></div>
            <div><span class="info-label">Monto</span><span class="amount-danger">$${parseFloat(mov.amount).toLocaleString('es-CL')}</span></div>
        </div>
    `;

    document.getElementById('anular-agency-id').value = agencyId;
    document.getElementById('anular-mov-id').value    = movId;
    document.getElementById('anular-motivo').value    = '';
    document.getElementById('modal-anular').style.display = 'flex';
};

/**
 * Confirma la anulación: marca el movimiento con estado ANULADO y motivo.
 * NO se elimina el registro — queda con trazabilidad completa.
 * Si el movimiento tenía voucherId, también se limpia para liberar la orden.
 */
window.confirmarAnulacion = function() {
    const agencyId = parseInt(document.getElementById('anular-agency-id').value);
    const movId    = parseInt(document.getElementById('anular-mov-id').value);
    const motivo   = document.getElementById('anular-motivo').value.trim();

    if (!motivo) return showToast('El motivo de anulación es obligatorio.', 'warning');

    const a   = db.agencies.find(x => x.id == agencyId);
    const mov = a?.movements.find(m => m.id == movId);
    if (!mov) return showToast('Movimiento no encontrado.', 'error');

    mov.estado           = 'ANULADO';
    mov.motivoAnulacion  = motivo;
    mov.fechaAnulacion   = new Date().toISOString().split('T')[0];
    // Si tenía voucher pendiente, se libera para que no bloquee futuros reembolsos
    if (mov.voucherId && !mov.liquidado) mov.voucherId = null;

    saveToLocalStorage();
    closeModal('modal-anular');
    showToast('Movimiento anulado correctamente.', 'success');

    // Refrescar el historial si está abierto
    window.viewHistory(agencyId);
    // Actualizar contador de vouchers pendientes
    window.updateVoucherBadge();
};

// ─────────────────────────────────────────────────────────────
// 9c. VISTA PAGOS PENDIENTES (Vouchers autorizados)
// ─────────────────────────────────────────────────────────────

/**
 * Recopila todos los vouchers pendientes de pago en todas las cajas
 * y los muestra como tarjetas accionables para el cajero.
 *
 * Un voucher está PENDIENTE si:
 *   - Existen movimientos 102.01 con ese voucherId y liquidado === false
 *   - NO existe un movimiento 602.01 con ese voucherId (aún no ejecutado)
 *   - El movimiento NO está ANULADO
 */
window.renderVouchersPendientes = function() {
    const container  = document.getElementById('vouchers-list');
    const emptyState = document.getElementById('vouchers-empty');
    if (!container)  return;

    // Recopilar todos los vouchers pendientes agrupados por voucherId
    const voucherMap = {}; // { voucherId: { agencyId, agencyName, total, items[], fecha } }

    db.agencies.forEach(a => {
        // IDs de vouchers ya liquidados en esta agencia (existe 602.01 con ese id)
        const liquidados = new Set(
            a.movements
                .filter(m => m.category === '602.01' && m.voucherId)
                .map(m => m.voucherId)
        );

        a.movements
            .filter(m =>
                m.category === '102.01' &&
                m.voucherId &&
                !m.liquidado &&
                m.estado !== 'ANULADO' &&
                !liquidados.has(m.voucherId)
            )
            .forEach(m => {
                if (!voucherMap[m.voucherId]) {
                    voucherMap[m.voucherId] = {
                        voucherId:  m.voucherId,
                        agencyId:   a.id,
                        agencyName: a.name,
                        total:      0,
                        items:      [],
                        fecha:      m.date
                    };
                }
                voucherMap[m.voucherId].total += parseFloat(m.amount || 0);
                voucherMap[m.voucherId].items.push(m);
            });
    });

    const vouchers = Object.values(voucherMap);

    // Actualizar badge del nav
    window.updateVoucherBadge(vouchers.length);

    if (vouchers.length === 0) {
        container.innerHTML  = '';
        emptyState.style.display = 'flex';
        return;
    }

    emptyState.style.display = 'none';
    container.innerHTML = vouchers.map(v => `
        <div class="voucher-card">
            <div class="voucher-card-header">
                <div>
                    <span class="badge-voucher voucher-lg">${escHtml(v.voucherId)}</span>
                    <span class="voucher-card-agency">${escHtml(v.agencyName)}</span>
                </div>
                <div class="voucher-card-total">$${v.total.toLocaleString('es-CL')}</div>
            </div>
            <div class="voucher-card-items">
                ${v.items.map(m => `
                    <div class="voucher-item-row">
                        <span class="voucher-item-doc">
                            ${m.tipoDoc ? escHtml(m.tipoDoc) : 'DOC'}
                            ${m.correlativo ? `<code>${escHtml(m.correlativo)}</code>` : ''}
                        </span>
                        <span class="voucher-item-concepto">${escHtml(m.concepto || '—')}</span>
                        <span class="voucher-item-monto">$${parseFloat(m.amount).toLocaleString('es-CL')}</span>
                    </div>
                `).join('')}
            </div>
            <div class="voucher-card-footer">
                <small class="text-muted">Generado: ${v.fecha}</small>
                <div class="voucher-card-actions">
                    <button class="btn-sm btn-outline"
                        onclick="mostrarInstruccionPago('${escHtml(v.voucherId)}', ${v.total})">
                        Ver instrucción
                    </button>
                    <button class="btn-sm btn-confirm"
                        onclick="showSection('view-gastos-ingresos', null); prefillVoucher('${escHtml(v.voucherId)}')">
                        Registrar Pago
                    </button>
                </div>
            </div>
        </div>
    `).join('');
};

/**
 * Pre-rellena el formulario de Gastos e Ingresos con el voucher seleccionado
 * para que el cajero solo deba confirmar el monto.
 */
window.prefillVoucher = function(voucherId) {
    // Asegurar que estamos en tipo EGRESO y categoría 602.01
    const tipoTrans = document.getElementById('gi-tipo-trans');
    if (tipoTrans) { tipoTrans.value = 'EGRESO'; window.renderCategoriasEnGastos(); }

    setTimeout(() => {
        const catSelect = document.getElementById('gi-categoria');
        if (catSelect) {
            catSelect.value = '602.01';
            window.handleCategoryChange();
        }
        const voucherInput = document.getElementById('gi-voucher-ref');
        if (voucherInput) {
            voucherInput.value = voucherId;
            window.validateVoucherRealTime();
        }
    }, 50);
};

/**
 * Muestra un toast con la instrucción de pago para un voucher.
 */
window.mostrarInstruccionPago = function(voucherId, total) {
    showToast(
        `Voucher ${voucherId}: ir a Gastos e Ingresos → Reembolso Caja Chica → ingresar este N° voucher. Monto: $${total.toLocaleString('es-CL')}`,
        'info',
        6000
    );
};

/**
 * Actualiza el badge numérico en el nav de Pagos Pendientes.
 */
window.updateVoucherBadge = function(count) {
    // Si no se pasa count, recalcular
    if (count === undefined) {
        let c = 0;
        db.agencies.forEach(a => {
            const liquidados = new Set(
                a.movements.filter(m => m.category === '602.01' && m.voucherId).map(m => m.voucherId)
            );
            const folios = new Set(
                a.movements
                    .filter(m => m.category === '102.01' && m.voucherId && !m.liquidado && m.estado !== 'ANULADO' && !liquidados.has(m.voucherId))
                    .map(m => m.voucherId)
            );
            c += folios.size;
        });
        count = c;
    }

    const badge = document.getElementById('badge-vouchers-count');
    if (!badge) return;
    badge.textContent    = count;
    badge.style.display  = count > 0 ? 'inline-flex' : 'none';
};

// ─────────────────────────────────────────────────────────────
// 9b. TOGGLE ESTATUS CAJA CHICA
// ─────────────────────────────────────────────────────────────

/**
 * Activa o desactiva la caja chica de una sucursal directamente desde la tabla.
 * Cuando está inactiva, las cuentas 102.01 y 602.01 quedan ocultas en el formulario
 * de Gastos e Ingresos para los cajeros de esa caja.
 */
window.toggleCajaChica = function(agencyId, estado) {
    const a = db.agencies.find(x => x.id == agencyId);
    if (!a) return;

    a.cajaChicaActiva = estado;
    saveToLocalStorage();

    const nombre = escHtml(a.name);
    const msg    = estado
        ? `Caja Chica activada para "${nombre}"`
        : `Caja Chica desactivada para "${nombre}"`;
    showToast(msg, estado ? 'success' : 'warning');

    window.renderSucursales();

    // Si el usuario activo es esta caja y está en el formulario, refrescar categorías
    if (activeAgencyId === agencyId) {
        const formVisible = document.getElementById('view-gastos-ingresos')?.style.display !== 'none';
        if (formVisible) window.renderCategoriasEnGastos();
    }
};

/**
 * Actualiza el texto del label del toggle en el modal CRUD según el estado del checkbox.
 */
window.updateToggleLabel = function() {
    const checked = document.getElementById('input-activa')?.checked;
    const label   = document.getElementById('toggle-label');
    if (!label) return;
    if (checked) {
        label.textContent = 'Activa — el cajero puede usar Caja Chica';
        label.className   = 'toggle-label-text toggle-on';
    } else {
        label.textContent = 'Inactiva — categorías de Caja Chica ocultas';
        label.className   = 'toggle-label-text toggle-off';
    }
};

// ─────────────────────────────────────────────────────────────
// 10. GESTIÓN DE USUARIOS / CONTEXTO
// ─────────────────────────────────────────────────────────────

/** Actualiza el select del header con las cajas actuales */
window.updateUserSelector = function() {
    const selector = document.getElementById('header-user-selector');
    if (!selector) return;

    selector.innerHTML = db.agencies
        .map(a => `<option value="${a.id}" ${a.id == activeAgencyId ? 'selected' : ''}>
            ${escHtml(a.name)}
        </option>`)
        .join('');
};

/** Cambia la caja activa y re-renderiza la vista actual */
window.switchUserContext = function() {
    activeAgencyId = parseInt(document.getElementById('header-user-selector').value);
    // Refrescar vista activa
    const visibleSection = document.querySelector('.view:not([style*="display: none"])')?.id;
    if (visibleSection) window.showSection(visibleSection, null);
};

// ─────────────────────────────────────────────────────────────
// 11. HELPERS DE MODALES
// ─────────────────────────────────────────────────────────────

window.openCreateModal  = window.openCreateModal || (() => {});
window.openAccountModal = function() {
    document.getElementById('acc-code').value = '';
    document.getElementById('acc-name').value = '';
    document.getElementById('acc-type').value = 'EGRESO';
    document.getElementById('modal-cuenta').style.display = 'flex';
};

window.closeModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
};

/** Cierra modal al hacer clic en el overlay (fondo oscuro) */
window.handleModalOverlayClick = function(event, modalId) {
    if (event.target.id === modalId) window.closeModal(modalId);
};

window.toggleUserSelector = function() {
    const isOtro = document.getElementById('ref-otro').checked;
    document.getElementById('user-selector-container').style.display = isOtro ? 'flex' : 'none';
};

// ─────────────────────────────────────────────────────────────
// 12. UTILIDADES
// ─────────────────────────────────────────────────────────────

/** Escapa HTML para evitar XSS al insertar strings en innerHTML */
function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────
// 13. INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    window.updateUserSelector();
    window.renderSucursales();
    window.updateVoucherBadge();
});