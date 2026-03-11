// --- 1. DATOS E INICIALIZACIÓN ---
const INITIAL_DATA = {
    agencies: [{ id: 1, name: "Agencia Santiago", fund: 1000, minT: 40, maxT: 70, movements: [] }],
    chartOfAccounts: [
        { id: "102.01", name: "Ingreso Caja Chica", type: "INGRESO" },
        { id: "602.01", name: "Reembolso Caja Chica", type: "EGRESO" },
        { id: "601.01", name: "Combustible", type: "EGRESO" }
    ]
};

let db = JSON.parse(localStorage.getItem('konnect_data')) || INITIAL_DATA;

const saveToLocalStorage = () => localStorage.setItem('konnect_data', JSON.stringify(db));

// --- 1. DEFINICIÓN DE CUENTAS HARDCODEADAS ---
const CUENTAS_FIJAS = [
    { id: "102.01", name: "Ingreso Caja Chica", type: "INGRESO", fixed: true },
    { id: "602.01", name: "Reembolso Caja Chica", type: "EGRESO", fixed: true }
];

// --- 2. FUNCIONES DE GESTIÓN (GLOBALES) ---

window.getConsumedAmount = function(agency) {
    // Filtramos solo los movimientos de tipo 'GASTO' para calcular la deuda
    return agency.movements
        .filter(m => m.type === 'GASTO')
        .reduce((sum, m) => sum + Math.abs(m.amount), 0);
};

window.renderSucursales = function() {
    const tbody = document.getElementById('tbody-sucursales');
    if (!tbody) return;
    tbody.innerHTML = db.agencies.map(a => {
        const consumed = window.getConsumedAmount(a);
        const percent = (consumed / a.fund) * 100;
        
        // Determinar color de la barra según umbrales configurados
        let statusClass = "progress-green";
        if (percent >= a.maxT) statusClass = "progress-red";
        else if (percent >= a.minT) statusClass = "progress-orange";

        return `
        <tr ondblclick="viewHistory(${a.id})" style="cursor:pointer">
            <td><strong>${a.name}</strong></td>
            <td>$${a.fund.toLocaleString()}</td>
            <td>
                <div class="usage-info">
                    <small>$${consumed.toLocaleString()} / $${a.fund.toLocaleString()}</small>
                    <div class="progress-bg">
                        <div class="progress-bar ${statusClass}" style="width: ${Math.min(percent, 100)}%"></div>
                    </div>
                </div>
            </td>
            <td>${a.minT}%</td>
            <td>${a.maxT}%</td>
            <td>
                <button class="btn-edit" onclick="event.stopPropagation(); editAgency(${a.id})">Editar</button>
                <button class="btn-danger" onclick="event.stopPropagation(); deleteAgency(${a.id})">Remover</button>
            </td>
        </tr>`;
    }).join('');
};

window.renderCuentas = function() {
    const tbody = document.getElementById('tbody-cuentas');
    if (!tbody) return;

    // Combinamos las fijas con las que el usuario cree
    const todasLasCuentas = [...CUENTAS_FIJAS, ...db.chartOfAccounts.filter(a => !a.fixed)];
    
    tbody.innerHTML = todasLasCuentas.map(acc => `
        <tr>
            <td><code>${acc.id}</code></td>
            <td>${acc.name} ${acc.fixed ? '<span class="badge-fixed">SISTEMA</span>' : ''}</td>
            <td>${acc.type}</td>
            <td>
                ${acc.fixed ? '-' : `<button class="btn-danger" onclick="deleteAccount('${acc.id}')">X</button>`}
            </td>
        </tr>
    `).join('');
};

window.renderCategoriasEnGastos = function() {
    const select = document.getElementById('gi-categoria');
    if(!select) return;
    
    const tipoActual = document.getElementById('gi-tipo-trans').value;
    
    // 1. Filtrar fijas según el tipo (Gasto o Ingreso)
    const fijasFiltradas = CUENTAS_FIJAS.filter(acc => acc.type === tipoActual);
    
    // 2. Filtrar las del usuario
    const usuarioFiltradas = db.chartOfAccounts.filter(acc => acc.type === tipoActual && !acc.fixed);
    
    // 3. Unir y renderizar
    const total = [...fijasFiltradas, ...usuarioFiltradas];
    
    select.innerHTML = total.map(acc => 
        `<option value="${acc.id}">${acc.id} - ${acc.name}</option>`
    ).join('');
    
    window.handleCategoryChange(); 
};

window.handleCategoryChange = function() {
    const catSelect = document.getElementById('gi-categoria');
    const montoInput = document.getElementById('gi-monto');
    const voucherContainer = document.getElementById('voucher-input-container');
    const extraFieldsIngreso = document.getElementById('extra-fields-ingreso');
    
    if (!catSelect || !montoInput) return;

    const val = catSelect.value;

    // REEMBOLSO (Gasto): Bloquea monto y pide Voucher
    if (val === "602.01") {
        voucherContainer.style.display = 'flex';
        extraFieldsIngreso.style.display = 'none';
        montoInput.readOnly = true;
        montoInput.style.backgroundColor = "#eee";
        montoInput.placeholder = "Validar voucher...";
    } 
    // INGRESO: No pide voucher, habilita monto manual y campos extra
    else if (val === "102.01") {
        voucherContainer.style.display = 'none';
        extraFieldsIngreso.style.display = 'block';
        montoInput.readOnly = false;
        montoInput.style.backgroundColor = "#fff";
        montoInput.placeholder = "0.00";
    }
    // OTROS: Comportamiento estándar
    else {
        voucherContainer.style.display = 'none';
        extraFieldsIngreso.style.display = 'none';
        montoInput.readOnly = false;
        montoInput.style.backgroundColor = "#fff";
    }
};

window.showSection = function(id) {
    document.querySelectorAll('.view').forEach(s => s.style.display = 'none');
    const target = document.getElementById(id);
    if (target) target.style.display = 'block';

    // Ejecutar renders según la sección
    if (id === 'view-admin-global') window.renderSucursales();
    if (id === 'view-plan-cuentas') window.renderCuentas();
    if (id === 'view-gastos-ingresos') window.renderCategoriasEnGastos();
};

// --- 3. LÓGICA DE MODALES Y OPERACIONES ---

window.openCreateModal = function() {
    document.getElementById('edit-id').value = "";
    document.getElementById('input-name').value = "";
    document.getElementById('input-fund').value = "";
    document.getElementById('modal-crud').style.display = 'flex';
};

window.saveAgency = function() {
    const id = document.getElementById('edit-id').value;
    const name = document.getElementById('input-name').value;
    const fund = parseInt(document.getElementById('input-fund').value);
    if (id) {
        const idx = db.agencies.findIndex(a => a.id == id);
        db.agencies[idx] = { ...db.agencies[idx], name, fund };
    } else {
        db.agencies.push({ id: Date.now(), name, fund, minT: 40, maxT: 70, movements: [] });
    }
    saveToLocalStorage();
    window.closeModal('modal-crud');
    window.renderSucursales();
};

window.editAgency = function(id) {
    const a = db.agencies.find(a => a.id == id);
    document.getElementById('edit-id').value = a.id;
    document.getElementById('input-name').value = a.name;
    document.getElementById('input-fund').value = a.fund;
    document.getElementById('modal-crud').style.display = 'flex';
};

window.viewHistory = function(id) {
    const a = db.agencies.find(x => x.id == id);
    if (!a) return;

    document.getElementById('history-agency-name').innerText = a.name;
    const tbody = document.getElementById('tbody-history');
    
    // Mostramos movimientos y permitimos seleccionar los "GASTOS" que no tengan voucher aún
    tbody.innerHTML = a.movements.length ? a.movements.map((m, index) => `
        <tr>
            <td>${m.date}</td>
            <td>${m.desc}</td>
            <td>$${m.amount.toLocaleString()}</td>
            <td>${m.voucherId ? `<span class="badge-voucher">${m.voucherId}</span>` : 
                (m.type === 'GASTO' ? `<input type="checkbox" class="chk-reembolso" data-index="${index}">` : '-')}</td>
        </tr>
    `).join('') : '<tr><td colspan="4">Sin movimientos registrados</td></tr>';

    // Añadir botón de acción en el modal
    const modalFooter = document.querySelector('#modal-history .modal-buttons-history');
    modalFooter.innerHTML = `
        <button class="btn-success" onclick="procesarReembolso(${id})">Generar Voucher de Reembolso</button>
        <button class="btn-cancel" onclick="closeModal('modal-history')">Cerrar</button>
    `;

    document.getElementById('modal-history').style.display = 'flex';
};

window.validateVoucherRealTime = function() {
    const folio = document.getElementById('gi-voucher-ref').value;
    let monto = null;
    db.agencies.forEach(a => {
        const m = a.movements.find(mv => mv.voucherId === folio);
        if(m) monto = m.amount;
    });
    if(monto) document.getElementById('gi-monto').value = monto;
};

window.saveGeneralTransaction = function() {
    const cat = document.getElementById('gi-categoria').value;
    const monto = parseFloat(document.getElementById('gi-monto').value);
    const pagadoA = document.getElementById('gi-pagado-a').value;
    const concepto = document.getElementById('gi-concepto').value;
    const tipoDoc = document.getElementById('gi-tipo-doc').value;
    const fecha = document.getElementById('gi-fecha').value;

    if (isNaN(monto) || monto <= 0) return alert("Ingrese un monto válido");

    // En un sistema real usaríamos el ID de la agencia del usuario logueado. 
    // Para este prototipo, usamos la primera agencia (Santiago).
    const agencia = db.agencies[0]; 

    const nuevoMovimiento = {
        date: fecha,
        category: cat,
        amount: monto,
        pagadoA: pagadoA,
        type: (cat === "102.01") ? "INGRESO" : "GASTO",
        desc: (cat === "102.01") ? `${concepto} (${tipoDoc})` : `Gasto general pagado a ${pagadoA}`,
        voucherId: null // Se llenará cuando el admin genere el reembolso
    };

    agencia.movements.push(nuevoMovimiento);
    saveToLocalStorage();
    
    alert("Transacción guardada y registrada en el historial de la sucursal.");
    showSection('view-admin-global');
};

window.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };
window.toggleUserSelector = function() {
    const isOtro = document.getElementById('ref-otro').checked;
    document.getElementById('user-selector-container').style.display = isOtro ? 'flex' : 'none';
};

// --- 4. ARRANQUE DEL SISTEMA ---
document.addEventListener('DOMContentLoaded', () => {
    window.renderSucursales();
});