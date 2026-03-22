document.addEventListener('DOMContentLoaded', () => {

    let UDI_VALOR = null;
    let UDI_FECHA = '—';
    let LAST_TABLE_DATA = null;
    // Guarda los valores manuales por año entre recálculos
    let manualValues = {};

    const $ = id => document.getElementById(id);
    const fmtMXN = (n, d=2) => new Intl.NumberFormat('es-MX', { minimumFractionDigits:d, maximumFractionDigits:d }).format(n);
    const fmtNum = (n, d=0) => new Intl.NumberFormat('es-MX', { minimumFractionDigits:d, maximumFractionDigits:d }).format(n);

    const showToast = msg => {
        $('toast-msg').textContent = msg;
        const t = $('toast');
        t.classList.remove('hidden');
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 400); }, 5000);
    };

    const setBadge = (type, text) => {
        $('badge-status').className = `badge badge-${type}`;
        $('badge-text').textContent = text;
    };

    // ── Caché localStorage ──────────────────────────
    // Guarda el valor de la UDI junto con la fecha del día (zona México).
    // Si el usuario abre la app de nuevo el mismo día, la app no hace ninguna
    // llamada a la red — lee el valor del navegador de forma instantánea.
    const CACHE_KEY = 'udi_cache_v1';

    function getTodayMX() {
        // Fecha en horario de México, independiente de la zona del usuario
        return new Date(new Date().toLocaleString('en-US', { timeZone:'America/Mexico_City' }))
                    .toISOString().split('T')[0];
    }

    function getCachedUDI() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const { data, date, savedOn } = JSON.parse(raw);
            if (savedOn !== getTodayMX()) return null; // expirado al día siguiente
            if (typeof data !== 'number' || data <= 0) return null; // sanity check
            return { data, date };
        } catch { return null; }
    }

    function setCachedUDI(data, date) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ data, date, savedOn: getTodayMX() }));
        } catch { /* Private-mode o sin localStorage — no bloquea */ }
    }

    function applyUDI(valor, fecha, source) {
        UDI_VALOR = valor;
        UDI_FECHA = fecha;
        $('header-udi-valor').textContent = `$${fmtMXN(UDI_VALOR, 6)}`;
        $('header-udi-fecha').textContent  = UDI_FECHA;
        $('udi-live').querySelector('.udi-live-loading').classList.add('hidden');
        $('udi-live').querySelector('.udi-live-content').classList.remove('hidden');
        setBadge(
            source === 'cache'   ? 'live'    :
            source === 'banxico' ? 'live'    :
            source === 'mock'    ? 'offline' : 'offline',
            source === 'cache'   ? `Caché · ${UDI_FECHA}` :
            source === 'banxico' ? `En vivo · ${UDI_FECHA}` :
            source === 'mock'    ? 'Modo Offline' : 'Sin conexión'
        );
    }

    // ── Fetch UDI con caché ────────────────────────
    async function fetchUDI() {
        setBadge('loading', 'Conectando...');

        // 1. ¿Tenemos el valor de hoy en localStorage?
        const cached = getCachedUDI();
        if (cached) {
            applyUDI(cached.data, cached.date, 'cache');
            updateKPIs();
            runProjection();
            return; // ← carga instantánea, sin llamada a la red
        }

        // 2. No hay caché válida → llamar a la API
        try {
            const res  = await fetch('/api/get-udi');
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Sin dato');
            setCachedUDI(data.data, data.date); // guardar para el resto del día
            applyUDI(data.data, data.date, data.source);
        } catch (err) {
            console.warn('[UDI] Error de red:', err.message);
            applyUDI(8.123456, 'respaldo', 'fallback');
            showToast('No se pudo conectar a Banxico. Usando valor de respaldo.');
        }

        updateKPIs();
        runProjection();
    }

    // ── KPI cards ──────────────────────────────────
    function updateKPIs() {
        if (!UDI_VALOR) return;
        const anios     = parseInt($('cfg-anios').value) || 10;
        const inflacion = parseFloat($('cfg-inflacion').value) / 100 || 0.04;

        const udiFuturo = UDI_VALOR * Math.pow(1 + inflacion, anios);
        const crec      = ((udiFuturo - UDI_VALOR) / UDI_VALOR) * 100;
        const ratio     = Math.pow(1 + inflacion, anios);

        $('kpi-udi-hoy').textContent       = `$${fmtMXN(UDI_VALOR, 6)}`;
        $('kpi-udi-hoy-sub').textContent   = `al ${UDI_FECHA}`;
        $('kpi-udi-futuro').textContent    = `$${fmtMXN(udiFuturo, 4)}`;
        $('kpi-anios-label').textContent   = anios;
        $('kpi-inflacion-label').textContent = `Con ${fmtNum(inflacion*100,1)}% inflación anual`;
        $('kpi-crecimiento').textContent   = `${fmtNum(crec, 1)}%`;
        $('kpi-ratio').textContent         = `${fmtNum(ratio, 2)}×`;
    }

    // ── Conversión rápida ──────────────────────────
    let foco = 'mxn';
    $('conv-mxn').addEventListener('input', () => {
        foco = 'mxn';
        if (!UDI_VALOR || $('conv-mxn').value === '') { $('conv-udis').value = ''; return; }
        const mxn = parseFloat($('conv-mxn').value);
        if (!isNaN(mxn)) $('conv-udis').value = parseFloat((mxn / UDI_VALOR).toFixed(6));
    });
    $('conv-udis').addEventListener('input', () => {
        foco = 'udis';
        if (!UDI_VALOR || $('conv-udis').value === '') { $('conv-mxn').value = ''; return; }
        const udis = parseFloat($('conv-udis').value);
        if (!isNaN(udis)) $('conv-mxn').value = parseFloat((udis * UDI_VALOR).toFixed(2));
    });
    $('swap-btn').addEventListener('click', () => {
        const tmp = $('conv-mxn').value;
        $('conv-mxn').value  = $('conv-udis').value;
        $('conv-udis').value = tmp;
        if (foco === 'mxn') $('conv-mxn').dispatchEvent(new Event('input'));
        else $('conv-udis').dispatchEvent(new Event('input'));
    });

    // ── Cambio de modo recalcula la tabla ──────────
    document.querySelectorAll('input[name="aport-tipo"]').forEach(r => {
        r.addEventListener('change', runProjection);
    });

    // ── PROYECCIÓN ─────────────────────────────────
    function getAportaciones(anios, aportAnual, isManual) {
        const out = [];
        for (let a = 1; a <= anios; a++) {
            if (isManual) {
                // Usa el valor manual guardado, o aportAnual como default
                out.push(manualValues[a] !== undefined ? manualValues[a] : aportAnual);
            } else {
                out.push(aportAnual);
            }
        }
        return out;
    }

    function runProjection() {
        if (!UDI_VALOR) return;

        const inflacion  = parseFloat($('cfg-inflacion').value) / 100 || 0.04;
        const anios      = parseInt($('cfg-anios').value) || 10;
        const udisBase   = parseFloat($('cfg-udis').value) || 1000;
        const periodo    = parseInt($('cfg-periodicidad').value) || 1;
        const isManual   = $('aport-manual').checked;
        const aportAnual = udisBase * periodo;

        const aportaciones = getAportaciones(anios, aportAnual, isManual);

        const rows = [];
        let udisAcum = 0, totalVP = 0;

        for (let a = 1; a <= anios; a++) {
            // Año 1 representa el día de hoy (a - 1 = 0 años de inflación)
            const udiAnio = UDI_VALOR * Math.pow(1 + inflacion, a - 1);
            const udisAno = aportaciones[a - 1];
            const aportVP = udisAno * UDI_VALOR;
            const aportVF = udisAno * udiAnio;
            udisAcum     += udisAno;
            totalVP      += aportVP;
            const totalVF = udisAcum * udiAnio;
            rows.push({ anio: a, udiAnio, udisAno, aportVP, aportVF, udisAcum, totalVP, totalVF });
        }

        const vfFinal    = rows[rows.length - 1]?.totalVF ?? 0;
        const udisTotal  = rows[rows.length - 1]?.udisAcum ?? 0;
        const rendimiento = totalVP > 0 ? ((vfFinal - totalVP) / totalVP) * 100 : 0;

        renderResults(rows, { inflacion, anios, totalVP, vfFinal, rendimiento, udisTotal, isManual, aportAnual });
        updateKPIs();
    }

    function renderResults(rows, { inflacion, anios, totalVP, vfFinal, rendimiento, udisTotal, isManual, aportAnual }) {
        // Resumen
        $('result-summary').innerHTML = `
            <div class="rs-card highlight">
                <span class="rs-label">Valor Futuro Total</span>
                <span class="rs-value">$${fmtMXN(vfFinal)}</span>
            </div>
            <div class="rs-card">
                <span class="rs-label">Total Aportado (VP)</span>
                <span class="rs-value">$${fmtMXN(totalVP)}</span>
            </div>
            <div class="rs-card">
                <span class="rs-label">UDIS Acumuladas</span>
                <span class="rs-value">${fmtNum(udisTotal, 2)}</span>
            </div>
            <div class="rs-card">
                <span class="rs-label">Rendimiento Nominal</span>
                <span class="rs-value" style="color:var(--accent-amber)">${fmtNum(rendimiento, 1)}%</span>
            </div>`;

        $('interpretation-box').innerHTML =
            `Con una inflación del <strong>${fmtNum(inflacion*100,1)}%</strong> anual, las aportaciones acumulan <strong>${fmtNum(udisTotal,2)} UDIS</strong>. Al valor proyectado de la UDI en el año ${anios}, eso equivale a <strong>$${fmtMXN(vfFinal)} MXN</strong>. El rendimiento nominal sobre lo aportado es del <strong>${fmtNum(rendimiento,1)}%</strong>.`;

        // ── Tabla con columna editable en modo manual ──
        $('proj-thead').innerHTML = `<tr>
            <th>Año</th>
            <th>UDI Proyectada</th>
            <th>UDIs a Aportar${isManual ? ' ✏️' : ''}</th>
            <th>Aportación VP</th>
            <th>Aportación VF</th>
            <th>UDIS Acumuladas</th>
            <th>Total VP</th>
            <th>Total VF</th>
        </tr>`;

        $('proj-tbody').innerHTML = rows.map(r => {
            const udisCell = isManual
                ? `<td><input type="number" class="inline-input" data-anio="${r.anio}" value="${r.udisAno}" min="0" step="any" style="width:90px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.3);border-radius:6px;padding:4px 8px;color:#f0f4ff;font-size:.85rem;font-family:inherit;text-align:right;outline:none;-moz-appearance:textfield;"></td>`
                : `<td>${fmtNum(r.udisAno, 2)}</td>`;
            return `<tr>
                <td>${r.anio}</td>
                <td>$${fmtMXN(r.udiAnio, 4)}</td>
                ${udisCell}
                <td class="col-blue">$${fmtMXN(r.aportVP)}</td>
                <td>$${fmtMXN(r.aportVF)}</td>
                <td>${fmtNum(r.udisAcum, 2)}</td>
                <td class="col-blue">$${fmtMXN(r.totalVP)}</td>
                <td class="col-green">$${fmtMXN(r.totalVF)}</td>
            </tr>`;
        }).join('');

        // Escuchar cambios en los inputs inline
        if (isManual) {
            $('proj-tbody').querySelectorAll('.inline-input').forEach(input => {
                // Quitar spinner nativo en Chrome
                input.style.webkitAppearance = 'none';
                input.addEventListener('change', () => {
                    const anio = parseInt(input.dataset.anio);
                    manualValues[anio] = parseFloat(input.value) || 0;
                    runProjection();
                });
            });
        }

        $('projection-results').classList.remove('hidden');

        // Guardar para exportar
        const headers = ['Año','UDI Proyectada','UDIs Aportadas','Aportación VP','Aportación VF','UDIS Acum.','Total VP','Total VF'];
        LAST_TABLE_DATA = {
            headers,
            rows: rows.map(r => [r.anio, `$${fmtMXN(r.udiAnio,4)}`, fmtNum(r.udisAno,2),
                `$${fmtMXN(r.aportVP)}`, `$${fmtMXN(r.aportVF)}`, fmtNum(r.udisAcum,2),
                `$${fmtMXN(r.totalVP)}`, `$${fmtMXN(r.totalVF)}`]),
            summary: { inflacion: inflacion*100, anios, totalVP, vfFinal, rendimiento, udisTotal }
        };
    }

    $('btn-calcular').addEventListener('click', () => {
        // Limpiar valores manuales si está en modo fijo
        if (!$('aport-manual').checked) manualValues = {};
        runProjection();
    });

    // Actualizar KPIs en tiempo real al cambiar config
    [$('cfg-inflacion'), $('cfg-anios'), $('cfg-udis'), $('cfg-periodicidad')].forEach(el => {
        el.addEventListener('input', updateKPIs);
    });

    // ── EXPORTACIÓN PDF ────────────────────────────
    $('btn-pdf').addEventListener('click', () => {
        if (!LAST_TABLE_DATA) return;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
        const D = LAST_TABLE_DATA, S = D.summary;

        // Fondo blanco total
        doc.setFillColor(255,255,255); doc.rect(0,0,297,210,'F');

        // Header: banda azul oscuro con texto blanco
        doc.setFillColor(15,30,68); doc.rect(0,0,297,32,'F');
        doc.setTextColor(255,255,255); doc.setFontSize(17); doc.setFont('helvetica','bold');
        doc.text('Calculadora de UDIS', 14, 13);
        doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(190,210,255);
        doc.text(`calculadoraudis.com  |  Banxico ${UDI_FECHA}: $${fmtMXN(UDI_VALOR,6)}  |  ${new Date().toLocaleDateString('es-MX')}`, 14, 21);
        doc.text(`Inflación: ${S.inflacion}%  |  Plazo: ${S.anios} años`, 14, 28);

        let cx = 14;
        
        // 1
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 90, 110); doc.text('VALOR FUTURO TOTAL', cx, 40);
        doc.setFontSize(13);
        doc.setTextColor(15, 60, 160); doc.text(`$${fmtMXN(S.vfFinal)}`, cx, 48);
        cx += 70;
        
        // 2
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 90, 110); doc.text('TOTAL APORTADO (VP)', cx, 40);
        doc.setFontSize(13);
        doc.setTextColor(30, 30, 30); doc.text(`$${fmtMXN(S.totalVP)}`, cx, 48);
        cx += 70;
        
        // 3
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 90, 110); doc.text('UDIS ACUMULADAS', cx, 40);
        doc.setFontSize(13);
        doc.setTextColor(30, 30, 30); doc.text(fmtNum(S.udisTotal, 2), cx, 48);
        cx += 70;
        
        // 4
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
        doc.setTextColor(80, 90, 110); doc.text('RENDIMIENTO NOMINAL', cx, 40);
        doc.setFontSize(13);
        doc.setTextColor(20, 100, 60); doc.text(`${fmtNum(S.rendimiento, 1)}%`, cx, 48);

        // Tabla con tema claro de alto contraste
        doc.autoTable({
            head: [D.headers],
            body: D.rows,
            startY: 59,
            theme: 'grid',
            headStyles: {
                fillColor: [15,30,68],
                textColor: [255,255,255],
                fontStyle: 'bold',
                fontSize: 7.5,
            },
            bodyStyles: {
                fillColor: [255,255,255],
                textColor: [25,25,25],
                fontSize: 7.5,
            },
            alternateRowStyles: {
                fillColor: [245,248,255],
            },
            columnStyles: {
                0: { halign:'center', textColor:[15,30,68], fontStyle:'bold' },
                7: { textColor:[15,80,200], fontStyle:'bold' },
            },
            styles: {
                lineColor: [200,210,230],
                lineWidth: 0.2,
            },
            margin: { left:14, right:14 },
        });

        const fy = doc.lastAutoTable.finalY + 6;
        doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(110,120,140);
        doc.text('Estimaciones con fines informativos. No constituyen asesoría financiera formal.', 14, fy);
        doc.setTextColor(15,80,200);
        doc.textWithLink('Sistema para asesores y promotorias: crm-gamo.vercel.app', 14, fy+5, { url:'https://crm-gamo.vercel.app' });
        doc.save(`proyeccion-udis-${new Date().toISOString().split('T')[0]}.pdf`);
    });

    // ── EXPORTACIÓN EXCEL ──────────────────────────
    $('btn-excel').addEventListener('click', () => {
        if (!LAST_TABLE_DATA) return;
        const D = LAST_TABLE_DATA, S = D.summary;
        const wb = XLSX.utils.book_new();
        const wsData = [
            ['Calculadora de UDIS — calculadoraudis.com'],
            [`UDI al ${UDI_FECHA}`, `$${fmtMXN(UDI_VALOR,6)}`],
            [`Inflación anual`, `${S.inflacion}%`],
            [`Plazo`, `${S.anios} años`],
            [],
            ['Valor Futuro Total', `$${fmtMXN(S.vfFinal)}`],
            ['Total Aportado (VP)', `$${fmtMXN(S.totalVP)}`],
            ['UDIS Acumuladas', fmtNum(S.udisTotal,2)],
            ['Rendimiento Nominal', `${fmtNum(S.rendimiento,1)}%`],
            [],
            D.headers, ...D.rows, [],
            ['Estimaciones con fines informativos.'],
            ['Sistema para asesores: https://crm-gamo.vercel.app'],
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = D.headers.map(()=>({ wch:18 }));
        XLSX.utils.book_append_sheet(wb, ws, 'Proyección UDIS');
        XLSX.writeFile(wb, `proyeccion-udis-${new Date().toISOString().split('T')[0]}.xlsx`);
    });

    // ── Iniciar ────────────────────────────────────
    fetchUDI();

    // ── LEGION BANNER — Tabs ───────────────────────
    const legionTabs   = document.querySelectorAll('.legion-tab');
    const legionPanels = { asesor: document.getElementById('panel-asesor'), promotor: document.getElementById('panel-promotor') };

    legionTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            // Update tab state
            legionTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            // Swap panels with fade
            Object.entries(legionPanels).forEach(([key, panel]) => {
                if (key === target) {
                    panel.classList.remove('hidden');
                    panel.style.opacity = '0';
                    requestAnimationFrame(() => {
                        panel.style.transition = 'opacity 0.22s ease';
                        panel.style.opacity = '1';
                    });
                } else {
                    panel.classList.add('hidden');
                    panel.style.opacity = '';
                }
            });
        });
    });

    // ── LEGION BANNER — Sticky dismiss ─────────────
    const STICKY_KEY  = 'legion_sticky_dismissed';
    const stickyEl    = document.getElementById('legion-sticky');
    const closeBtn    = document.getElementById('legion-sticky-close');

    function showSticky() {
        document.body.classList.add('legion-sticky-active');
        stickyEl.classList.remove('hidden');
    }

    function dismissSticky() {
        stickyEl.classList.add('hidden');
        document.body.classList.remove('legion-sticky-active');
        try { localStorage.setItem(STICKY_KEY, '1'); } catch {}
    }

    // Check if already dismissed in this session
    try {
        if (!localStorage.getItem(STICKY_KEY)) showSticky();
    } catch {
        showSticky(); // If localStorage unavailable, show anyway
    }

    closeBtn.addEventListener('click', dismissSticky);
});
