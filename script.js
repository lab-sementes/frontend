/* ==========================================================================
   LABORATÓRIO DE SEMENTES - MONITORAMENTO AMIGÁVEL E INTUITIVO
   Foco em Clareza, Simplicidade e Usabilidade para Professores e Alunos
   ========================================================================== */

const API_URL = 'https://api.thalesgmartins.com.br';

// Limiares Padrão de Fábrica (usados quando o banco não tiver limites cadastrados)
// Geladeiras: 2°C a 8°C (padrão de conservação de amostras e frio)
// Ambientes de Amostras/Germinação: 18°C a 24°C (padrão de análise de sementes / RAS MAPA)
const LIMITES_PADRAO = {
    'geladeiras': { tempMin: 2.0, tempMax: 8.0, umidMin: 0.0, umidMax: 100.0, rotulo: '2°C a 8°C' },
    'amostras': { tempMin: 18.0, tempMax: 24.0, umidMin: 40.0, umidMax: 60.0, rotulo: '18°C a 24°C' }
};

// Cores suaves para os gráficos
const CORES_PALETA = [
    { border: '#059669', bg: 'rgba(5, 150, 105, 0.08)' }, // Verde (Ambiente)
    { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' },  // Azul (Geladeira 1)
    { border: '#7c3aed', bg: 'rgba(124, 58, 237, 0.08)' }, // Roxo (Geladeira 2)
    { border: '#ea580c', bg: 'rgba(234, 88, 12, 0.08)' },  // Laranja (Geladeira 3)
    { border: '#0891b2', bg: 'rgba(8, 145, 178, 0.08)' }   // Ciano (Novo equipamento)
];

// Estado da Aplicação
let todosSensores = [];
let salasCadastradas = {}; // Mapeamento dinâmico de todas as salas
let salaAtual = 'geladeiras';
let subSensorAtual = 'todos'; // 'todos' ou ID do sensor
let periodoAtual = '24h';
let modoVisaoAtual = 'graficos'; // 'graficos' ou 'tabela'
let ordemTabelaRecente = true;
let consultandoHistoricoQueda = false;

let dadosTabelaAtual = [];
let leiturasAtuaisCache = {};

let graficoTemp = null;
let graficoUmid = null;

// ==========================================================================
// INICIALIZAÇÃO
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Carrega todos os sensores e salas da API dinamicamente
    await carregarSensoresDaAPI();

    // 2. Filtros de Período (6h, 24h, 7d)
    document.querySelectorAll('.filtro-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const botao = e.currentTarget;
            document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('active'));
            botao.classList.add('active');

            periodoAtual = botao.dataset.periodo;
            consultandoHistoricoQueda = false;

            destruirGraficos();
            atualizarDashboard();
        });
    });

    // 3. Alternador de Visão (Gráficos vs Tabela)
    document.querySelectorAll('.modo-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const botao = e.currentTarget;
            document.querySelectorAll('.modo-btn').forEach(b => b.classList.remove('active'));
            botao.classList.add('active');

            modoVisaoAtual = botao.dataset.modo;
            alternarVisao();
        });
    });

    // 4. Inversão de Ordem da Tabela
    const btnToggleOrdem = document.getElementById('toggle-ordem-btn');
    if (btnToggleOrdem) {
        btnToggleOrdem.addEventListener('click', () => {
            ordemTabelaRecente = !ordemTabelaRecente;
            const ordemText = document.getElementById('ordem-text');
            const icon = btnToggleOrdem.querySelector('i');
            
            if (ordemTabelaRecente) {
                ordemText.innerText = 'Mais recentes primeiro';
                icon.className = 'fa-solid fa-arrow-down-short-wide';
            } else {
                ordemText.innerText = 'Mais antigos primeiro';
                icon.className = 'fa-solid fa-arrow-up-wide-short';
            }
            renderizarTabelaHistorica();
        });
    }

    // 5. Botão de Exportação para Excel
    const btnExportarCSV = document.getElementById('exportar-csv-btn');
    if (btnExportarCSV) {
        btnExportarCSV.addEventListener('click', exportarPlanilhaExcel);
    }

    // 6. Botão para ver medições gravadas antes da queda (no estado vazio)
    const btnHistoricoAntigo = document.getElementById('btn-carregar-historico-antigo');
    if (btnHistoricoAntigo) {
        btnHistoricoAntigo.addEventListener('click', () => {
            consultandoHistoricoQueda = !consultandoHistoricoQueda;
            destruirGraficos();
            atualizarDashboard();
        });
    }

    // Inicia interface
    configurarBotoesEquipamentos();
    atualizarTextosFaixaIdeal();
    atualizarDashboard();

    // Atualiza suavemente a cada 30 segundos
    setInterval(atualizarDashboard, 30000);
});

// Destrói os gráficos para limpar datasets e tooltips ao trocar de sala ou modo
function destruirGraficos() {
    if (graficoTemp) {
        graficoTemp.destroy();
        graficoTemp = null;
    }
    if (graficoUmid) {
        graficoUmid.destroy();
        graficoUmid = null;
    }
}

// ==========================================================================
// ALTERNAR ENTRE GRÁFICOS E TABELA
// ==========================================================================
function alternarVisao() {
    const visaoGraficos = document.getElementById('visao-graficos');
    const visaoTabela = document.getElementById('visao-tabela');

    if (!visaoGraficos || !visaoTabela) return;

    if (modoVisaoAtual === 'tabela') {
        visaoGraficos.style.display = 'none';
        visaoTabela.style.display = 'block';
    } else {
        visaoGraficos.style.display = 'block';
        visaoTabela.style.display = 'none';
        if (graficoTemp) graficoTemp.resize();
        if (graficoUmid) graficoUmid.resize();
    }
}

// ==========================================================================
// CARREGAR SENSORES E CONFIGURAÇÕES DA API (100% DINÂMICO)
// ==========================================================================
async function carregarSensoresDaAPI() {
    try {
        const res = await fetch(`${API_URL}/sensores`);
        if (!res.ok) throw new Error('Falha ao buscar sensores');
        todosSensores = await res.json();

        salasCadastradas = {};

        todosSensores.forEach(s => {
            if (s.status === 'Desativado') return;

            // Extrai ou normaliza o nome da sala (Ex: "Geladeiras", "Amostras", "Germinador")
            const salaRaw = (s.sala || 'Geral').trim();
            const chaveSala = salaRaw.toLowerCase();

            if (!salasCadastradas[chaveSala]) {
                // Tenta puxar os limites salvos no banco para este sensor
                let tMin = s.tempMin !== null && s.tempMin !== undefined ? Number(s.tempMin) : null;
                let tMax = s.tempMax !== null && s.tempMax !== undefined ? Number(s.tempMax) : null;
                let uMin = s.umidMin !== null && s.umidMin !== undefined ? Number(s.umidMin) : null;
                let uMax = s.umidMax !== null && s.umidMax !== undefined ? Number(s.umidMax) : null;

                // Fallback padrão se não estiver cadastrado no banco:
                if (tMin === null || tMax === null) {
                    if (chaveSala.includes('geladeira') || chaveSala.includes('fria')) {
                        tMin = LIMITES_PADRAO.geladeiras.tempMin;
                        tMax = LIMITES_PADRAO.geladeiras.tempMax;
                    } else {
                        tMin = LIMITES_PADRAO.amostras.tempMin;
                        tMax = LIMITES_PADRAO.amostras.tempMax;
                    }
                }
                if (uMin === null || uMax === null) {
                    uMin = 40.0;
                    uMax = 60.0;
                }

                const nomeFormatado = salaRaw.toLowerCase().startsWith('sala') ? salaRaw : `Sala de ${salaRaw}`;

                salasCadastradas[chaveSala] = {
                    chave: chaveSala,
                    nomeExibicao: nomeFormatado,
                    sensores: [],
                    tempMin: tMin,
                    tempMax: tMax,
                    umidMin: uMin,
                    umidMax: uMax,
                    rotulo: `${tMin}°C a ${tMax}°C`
                };
            }

            salasCadastradas[chaveSala].sensores.push(s);
        });

        // Ordena sensores da sala (Ambiente/DHT primeiro, depois sondas)
        Object.keys(salasCadastradas).forEach(k => {
            salasCadastradas[k].sensores.sort((a, b) => {
                if (a.sensorType === 'DHT11') return -1;
                if (b.sensorType === 'DHT11') return 1;
                return (a.sensorName || '').localeCompare(b.sensorName || '');
            });
        });

        // Se a sala atual não existir nas salas cadastradas, seleciona a primeira disponível
        const chavesDisponiveis = Object.keys(salasCadastradas);
        if (chavesDisponiveis.length > 0 && !salasCadastradas[salaAtual]) {
            salaAtual = chavesDisponiveis[0];
        }

        renderizarBotoesSalas();

    } catch (e) {
        console.warn('Erro ao carregar dados dinâmicos da API, usando padrão:', e);
    }
}

// Renderiza os botões de sala no topo dinamicamente conforme os sensores cadastrados
function renderizarBotoesSalas() {
    const container = document.getElementById('room-selector-buttons');
    if (!container) return;

    const chaves = Object.keys(salasCadastradas);
    if (chaves.length === 0) return;

    container.innerHTML = '';

    chaves.forEach(chave => {
        const infoSala = salasCadastradas[chave];
        const btn = document.createElement('button');
        const isActive = chave === salaAtual;
        btn.className = `room-btn ${isActive ? 'active' : ''}`;
        btn.dataset.room = chave;

        // Ícone contextual por tipo de sala
        let icone = 'fa-door-open';
        if (chave.includes('geladeira') || chave.includes('fria')) icone = 'fa-snowflake';
        else if (chave.includes('amostra')) icone = 'fa-flask-vial';
        else if (chave.includes('germin')) icone = 'fa-sprout';

        btn.innerHTML = `<i class="fa-solid ${icone}"></i> ${infoSala.nomeExibicao}`;

        btn.onclick = () => {
            document.querySelectorAll('.room-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            salaAtual = chave;
            subSensorAtual = 'todos';
            consultandoHistoricoQueda = false;

            document.getElementById('room-title').innerText = infoSala.nomeExibicao;

            destruirGraficos();
            configurarBotoesEquipamentos();
            atualizarTextosFaixaIdeal();
            atualizarDashboard();
        };

        container.appendChild(btn);
    });

    const infoAtual = salasCadastradas[salaAtual];
    if (infoAtual) {
        document.getElementById('room-title').innerText = infoAtual.nomeExibicao;
    }
}

function obterNomeAmigavel(sensor) {
    if (!sensor) return 'Equipamento';
    const nome = sensor.sensorName || '';
    if (nome.includes('Geladeira 1')) return 'Geladeira 1';
    if (nome.includes('Geladeira 2')) return 'Geladeira 2';
    if (nome.includes('Geladeira 3')) return 'Geladeira 3';
    if (nome.includes('Geladeiras') && sensor.sensorType === 'DHT11') return 'Ambiente da Sala';
    if (nome.includes('Amostras')) return 'Sala de Amostras';
    return nome.replace(/DHT11|DHT22|DS18B20/gi, '').trim() || nome;
}

// ==========================================================================
// BOTÕES DE EQUIPAMENTOS DA SALA (CHIPS LIMPOS)
// ==========================================================================
function configurarBotoesEquipamentos() {
    const container = document.getElementById('sensor-tabs-container');
    const botoesDiv = document.getElementById('sensor-tabs-buttons');
    if (!container || !botoesDiv) return;

    const infoSala = salasCadastradas[salaAtual];
    const sensores = infoSala ? infoSala.sensores : [];

    if (sensores.length > 1) {
        container.style.display = 'flex';
        botoesDiv.innerHTML = '';

        // Botão "Comparativo de Geladeiras / Equipamentos"
        const btnTodos = document.createElement('button');
        btnTodos.className = `sensor-tab-btn ${subSensorAtual === 'todos' ? 'active' : ''}`;
        const textoTodos = salaAtual.includes('geladeira') ? 'Comparativo de Geladeiras' : 'Comparativo Geral';
        btnTodos.innerHTML = `<i class="fa-solid fa-chart-line"></i> ${textoTodos}`;
        btnTodos.onclick = () => {
            subSensorAtual = 'todos';
            consultandoHistoricoQueda = false;
            destruirGraficos();
            atualizarAbasAtivas();
            atualizarDashboard();
        };
        botoesDiv.appendChild(btnTodos);

        // Botão para cada equipamento individual
        sensores.forEach(s => {
            const btn = document.createElement('button');
            const isActive = subSensorAtual === String(s.id);
            btn.className = `sensor-tab-btn ${isActive ? 'active' : ''}`;

            const nomeLimpo = obterNomeAmigavel(s);
            const icone = s.sensorType === 'DS18B20' ? 'fa-snowflake' : 'fa-door-open';
            btn.innerHTML = `<i class="fa-solid ${icone}"></i> ${nomeLimpo}`;
            btn.onclick = () => {
                subSensorAtual = String(s.id);
                consultandoHistoricoQueda = false;
                destruirGraficos();
                atualizarAbasAtivas();
                atualizarDashboard();
            };
            botoesDiv.appendChild(btn);
        });
    } else {
        container.style.display = 'none';
        subSensorAtual = sensores.length > 0 ? String(sensores[0].id) : 'todos';
    }
}

function atualizarAbasAtivas() {
    const botoes = document.querySelectorAll('.sensor-tab-btn');
    botoes.forEach(btn => {
        btn.classList.remove('active');
        if (subSensorAtual === 'todos' && btn.innerText.includes('Comparativo')) {
            btn.classList.add('active');
        } else if (subSensorAtual !== 'todos') {
            const infoSala = salasCadastradas[salaAtual];
            const sensor = (infoSala ? infoSala.sensores : []).find(s => String(s.id) === subSensorAtual);
            if (sensor && btn.innerText.includes(obterNomeAmigavel(sensor))) {
                btn.classList.add('active');
            }
        }
    });
}

// ==========================================================================
// ATUALIZAÇÃO DO DASHBOARD
// ==========================================================================
async function atualizarDashboard() {
    const infoSala = salasCadastradas[salaAtual];
    const sensores = infoSala ? infoSala.sensores : [];
    if (sensores.length === 0) return;

    // 1. Busca as leituras mais recentes para os cards
    await buscarUltimasLeituras(sensores);

    // 2. Verifica se a sala ou aparelho está sem sinal
    verificarSinalDispositivo(sensores);

    // 3. Bucket de tempo
    let bucket = '1 hour';
    if (periodoAtual === '6h') bucket = '10 minutes';
    else if (periodoAtual === '24h') bucket = '1 hour';
    else if (periodoAtual === '7d') bucket = '6 hours';

    // 4. Carrega os dados
    try {
        if (subSensorAtual === 'todos' && sensores.length > 1) {
            await carregarDadosComparativoGeladeiras(sensores, bucket);
        } else {
            const sensorId = subSensorAtual === 'todos' ? sensores[0].id : Number(subSensorAtual);
            const sensorObj = sensores.find(s => s.id === sensorId) || sensores[0];
            await carregarDadosEquipamentoIndividual(sensorObj, bucket);
        }
    } catch (e) {
        console.error('Erro ao carregar dados:', e);
    }
}

// ==========================================================================
// BUSCAR ÚLTIMAS LEITURAS PARA OS CARDS
// ==========================================================================
async function buscarUltimasLeituras(sensores) {
    leiturasAtuaisCache = {};

    await Promise.all(
        sensores.map(async (s) => {
            try {
                const res = await fetch(`${API_URL}/measurements/${s.id}/latest`);
                if (res.ok) {
                    leiturasAtuaisCache[s.id] = await res.json();
                }
            } catch (e) {
                console.warn(`Erro na leitura do sensor ${s.id}:`, e);
            }
        })
    );

    renderizarCardsLaterais(sensores);
}

// ==========================================================================
// RENDERIZAR CARDS LATERAIS
// ==========================================================================
function renderizarCardsLaterais(sensores) {
    const container = document.getElementById('cards-leituras-container');
    if (!container) return;
    container.innerHTML = '';

    const infoSala = salasCadastradas[salaAtual] || LIMITES_PADRAO.geladeiras;

    if (sensores.length > 1) {
        sensores.forEach(s => {
            const leitura = leiturasAtuaisCache[s.id];
            const nomeAmigavel = obterNomeAmigavel(s);
            const temp = leitura && leitura.temperature !== null ? Number(leitura.temperature).toFixed(1) : '--';
            const temUmid = s.sensorType === 'DHT11';
            const umid = temUmid && leitura && leitura.humidity !== null ? Number(leitura.humidity).toFixed(1) + '%' : null;

            let statusTexto = 'Normal';
            let statusClasse = 'ok';

            if (leitura && leitura.temperature !== null) {
                const t = leitura.temperature;
                if (t < infoSala.tempMin) {
                    statusTexto = `${(infoSala.tempMin - t).toFixed(1)}°C abaixo`;
                    statusClasse = 'alerta';
                } else if (t > infoSala.tempMax) {
                    statusTexto = `${(t - infoSala.tempMax).toFixed(1)}°C acima`;
                    statusClasse = 'alerta';
                }
            }

            const isSelecionado = subSensorAtual === String(s.id);
            const card = document.createElement('div');
            card.className = `card-leitura-item ${isSelecionado ? 'selecionado' : ''}`;
            card.onclick = () => {
                subSensorAtual = String(s.id);
                consultandoHistoricoQueda = false;
                destruirGraficos();
                atualizarAbasAtivas();
                atualizarDashboard();
            };

            const icone = s.sensorType === 'DS18B20' ? 'fa-snowflake' : 'fa-door-open';

            card.innerHTML = `
                <div class="card-leitura-topo">
                    <span class="card-leitura-nome"><i class="fa-solid ${icone}"></i> ${nomeAmigavel}</span>
                    <span class="card-leitura-tag ${statusClasse}">${statusTexto}</span>
                </div>
                <div class="card-leitura-valores">
                    <span class="card-leitura-temp">${temp} °C</span>
                    ${umid ? `<span class="card-leitura-umid"><i class="fa-solid fa-droplet"></i> ${umid}</span>` : ''}
                </div>
            `;
            container.appendChild(card);
        });
    } else {
        const sensor = sensores[0];
        const leitura = leiturasAtuaisCache[sensor.id];
        const temp = leitura && leitura.temperature !== null ? Number(leitura.temperature).toFixed(1) : '--';
        const umid = leitura && leitura.humidity !== null ? Number(leitura.humidity).toFixed(1) + '%' : '--';

        let statusTexto = 'Normal';
        let statusClasse = 'ok';
        if (leitura && leitura.temperature !== null) {
            const t = leitura.temperature;
            if (t < infoSala.tempMin || t > infoSala.tempMax) {
                statusTexto = 'Fora do ideal';
                statusClasse = 'alerta';
            }
        }

        const card = document.createElement('div');
        card.className = 'card-leitura-item selecionado';
        card.innerHTML = `
            <div class="card-leitura-topo">
                <span class="card-leitura-nome"><i class="fa-solid fa-flask-vial"></i> ${infoSala.nomeExibicao}</span>
                <span class="card-leitura-tag ${statusClasse}">${statusTexto}</span>
            </div>
            <div class="card-leitura-valores">
                <span class="card-leitura-temp">${temp} °C</span>
                <span class="card-leitura-umid"><i class="fa-solid fa-droplet"></i> ${umid}</span>
            </div>
        `;
        container.appendChild(card);
    }
}

// ==========================================================================
// VERIFICAR SINAL DO DISPOSITIVO
// ==========================================================================
function verificarSinalDispositivo(sensores) {
    const banner = document.getElementById('offline-alert-banner');
    const badgeStatus = document.getElementById('sensor-status-badge');
    const textoStatus = document.getElementById('sensor-status-text');

    let sensorId = subSensorAtual === 'todos' ? sensores[0].id : Number(subSensorAtual);
    const sensorObj = sensores.find(s => s.id === sensorId) || sensores[0];
    const leitura = leiturasAtuaisCache[sensorObj.id];
    const ts = leitura?.id?.ts || leitura?.ts;

    if (!ts) {
        badgeStatus.className = 'sensor-status-badge status-offline';
        textoStatus.innerText = '● Sem medições';
        if (banner) banner.style.display = 'none';
        return;
    }

    const dataLeitura = new Date(ts);
    const diffMinutos = Math.floor((Date.now() - dataLeitura.getTime()) / 60000);

    if (diffMinutos <= 20) {
        badgeStatus.className = 'sensor-status-badge status-online';
        textoStatus.innerText = '● Atualizado agora';
        if (banner) banner.style.display = 'none';
    } else if (diffMinutos <= 120) {
        badgeStatus.className = 'sensor-status-badge status-alerta';
        textoStatus.innerText = `● Sem sinal há ${diffMinutos} min`;
        if (banner) banner.style.display = 'none';
    } else {
        badgeStatus.className = 'sensor-status-badge status-offline';
        textoStatus.innerText = '● Sem sinal recente';

        if (banner) {
            banner.style.display = 'flex';
            const nomeAmigavel = obterNomeAmigavel(sensorObj);
            const dataHoraSimples = formatarDataHoraAmigavel(ts);

            document.getElementById('offline-alert-desc').innerHTML = 
                `<strong>${nomeAmigavel} está sem sinal:</strong> última leitura recebida em <strong>${dataHoraSimples}</strong>. Verifique se o aparelho na sala está ligado na tomada.`;
        }
    }
}

// ==========================================================================
// DADOS: COMPARATIVO DE GELADEIRAS
// ==========================================================================
async function carregarDadosComparativoGeladeiras(sensores, bucket) {
    const infoSala = salasCadastradas[salaAtual] || LIMITES_PADRAO.geladeiras;
    const avisoTempVazio = document.getElementById('aviso-grafico-temp-vazio');
    const canvasTemp = document.getElementById('grafico-temperatura');

    const resultados = await Promise.all(
        sensores.map(async (s) => {
            try {
                const res = await fetch(`${API_URL}/measurements/${s.id}/aggregates?bucket=${bucket}`);
                if (!res.ok) return { sensor: s, dados: [] };
                const dados = await res.json();
                return { sensor: s, dados: Array.isArray(dados) ? dados : [] };
            } catch (e) {
                return { sensor: s, dados: [] };
            }
        })
    );

    const sensorAmbiente = resultados.find(r => r.sensor.sensorType === 'DHT11') || resultados[0];

    // ======================================================================
    // FILTRO TEMPORAL REAL EM RELAÇÃO A AGORA (Date.now())
    // ======================================================================
    const janelaMs = obterDuracaoJanelaMs(periodoAtual);
    const cutoff = Date.now() - janelaMs;

    resultados.forEach(r => {
        const dadosFiltrados = r.dados.filter(h => new Date(h.hora).getTime() >= cutoff);
        r.dadosCronologicos = [...dadosFiltrados].reverse();
    });

    const todosTimestamps = new Set();
    resultados.forEach(r => {
        r.dadosCronologicos.forEach(d => todosTimestamps.add(d.hora));
    });
    const timestampsOrdenados = Array.from(todosTimestamps).sort();

    // Se não houver dados no período
    if (timestampsOrdenados.length === 0) {
        if (canvasTemp) canvasTemp.style.display = 'none';
        if (avisoTempVazio) {
            avisoTempVazio.style.display = 'block';
            document.getElementById('texto-grafico-temp-vazio').innerText = `Nenhuma medição recebida nas últimas ${periodoAtual.replace('h', ' horas').replace('d', ' dias')}.`;
            document.getElementById('subtexto-grafico-temp-vazio').innerText = 'Aguardando novas leituras dos aparelhos.';
            document.getElementById('acao-ver-historico-queda').style.display = 'none';
        }
        exibirTabelaVazia('Nenhum registro nas últimas ' + periodoAtual);
        atualizarPainelResumo([], [], 0, 0, false);
        return;
    }

    if (canvasTemp) canvasTemp.style.display = 'block';
    if (avisoTempVazio) avisoTempVazio.style.display = 'none';

    const labels = timestampsOrdenados.map(ts => formatarLabelEixo(ts, periodoAtual));

    const datasetsTemp = resultados.map((r, idx) => {
        const mapaHoraValor = {};
        r.dadosCronologicos.forEach(d => {
            mapaHoraValor[d.hora] = d.media !== null ? Number(d.media.toFixed(1)) : null;
        });

        const cor = CORES_PALETA[idx % CORES_PALETA.length];
        return {
            label: obterNomeAmigavel(r.sensor),
            data: timestampsOrdenados.map(ts => mapaHoraValor[ts] !== undefined ? mapaHoraValor[ts] : null),
            borderColor: cor.border,
            backgroundColor: cor.bg,
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 6
        };
    });

    renderizarGraficoTemperaturaComparativo(labels, datasetsTemp, infoSala.tempMin, infoSala.tempMax);

    // Umidade Ambiente
    const wrapperUmid = document.getElementById('wrapper-grafico-umidade');
    if (wrapperUmid) wrapperUmid.style.display = 'block';

    if (sensorAmbiente && sensorAmbiente.dadosCronologicos.length > 0) {
        const labelsUmid = sensorAmbiente.dadosCronologicos.map(d => formatarLabelEixo(d.hora, periodoAtual));
        const hums = sensorAmbiente.dadosCronologicos.map(d => d.media_umidade !== null ? Number(d.media_umidade.toFixed(1)) : null);
        renderizarGraficoUmidade(labelsUmid, hums, infoSala);
    }

    montarTabelaMultiplos(resultados, infoSala);
    calcularResumoGeral(resultados, infoSala, true);
}

// ==========================================================================
// DADOS: EQUIPAMENTO INDIVIDUAL
// ==========================================================================
async function carregarDadosEquipamentoIndividual(sensorObj, bucket) {
    const infoSala = salasCadastradas[salaAtual] || LIMITES_PADRAO.amostras;
    const wrapperUmid = document.getElementById('wrapper-grafico-umidade');
    const isGeladeira = sensorObj.sensorType === 'DS18B20';
    const avisoTempVazio = document.getElementById('aviso-grafico-temp-vazio');
    const canvasTemp = document.getElementById('grafico-temperatura');
    const acaoVerQueda = document.getElementById('acao-ver-historico-queda');
    const btnHistoricoAntigo = document.getElementById('btn-carregar-historico-antigo');
    const tituloGrafico = document.getElementById('titulo-grafico-temp');

    if (isGeladeira) {
        if (wrapperUmid) wrapperUmid.style.display = 'none';
    } else {
        if (wrapperUmid) wrapperUmid.style.display = 'block';
    }

    const resHist = await fetch(`${API_URL}/measurements/${sensorObj.id}/aggregates?bucket=${bucket}`);
    if (!resHist.ok) return;

    const historico = await resHist.json();
    if (!Array.isArray(historico) || historico.length === 0) {
        mostrarEstadoVazio(sensorObj);
        return;
    }

    // Filtragem temporal estrita
    const janelaMs = obterDuracaoJanelaMs(periodoAtual);
    const cutoff = Date.now() - janelaMs;

    let historicoFiltrado = [];

    if (consultandoHistoricoQueda) {
        historicoFiltrado = historico.slice(0, 24);
        tituloGrafico.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Histórico Antes da Queda (07/09/2026)`;
        if (btnHistoricoAntigo) {
            btnHistoricoAntigo.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Voltar para o período atual`;
        }
    } else {
        historicoFiltrado = historico.filter(h => new Date(h.hora).getTime() >= cutoff);
        tituloGrafico.innerHTML = `<i class="fa-solid fa-temperature-half"></i> Histórico de Temperatura`;
        if (btnHistoricoAntigo) {
            btnHistoricoAntigo.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Ver últimas medições gravadas antes da queda (07/09)`;
        }
    }

    // SE NÃO HOUVER DADOS NO PERÍODO SOLICITADO:
    if (historicoFiltrado.length === 0) {
        if (canvasTemp) canvasTemp.style.display = 'none';
        if (avisoTempVazio) {
            avisoTempVazio.style.display = 'block';
            document.getElementById('texto-grafico-temp-vazio').innerText = 
                `Nenhuma medição recebida nas últimas ${periodoAtual.replace('h', ' horas').replace('d', ' dias')}.`;
            
            const tsUltimo = leiturasAtuaisCache[sensorObj.id]?.id?.ts || historico[0]?.hora;
            const dataUltima = tsUltimo ? formatarDataHoraAmigavel(tsUltimo) : 'data desconhecida';
            
            document.getElementById('subtexto-grafico-temp-vazio').innerText = 
                `O aparelho está sem sinal recente (última leitura em ${dataUltima}).`;
            
            if (acaoVerQueda) acaoVerQueda.style.display = 'block';
        }

        if (wrapperUmid) wrapperUmid.style.display = 'none';

        exibirTabelaVazia(`Nenhum registro nas últimas ${periodoAtual.replace('h', ' horas').replace('d', ' dias')} (Aparelho sem sinal).`);
        atualizarPainelResumo([], [], 0, 0, false);
        return;
    }

    if (canvasTemp) canvasTemp.style.display = 'block';
    if (avisoTempVazio) avisoTempVazio.style.display = 'none';

    const historicoCronologico = [...historicoFiltrado].reverse();

    const labels = historicoCronologico.map(h => formatarLabelEixo(h.hora, periodoAtual));
    const temps = historicoCronologico.map(h => h.media !== null ? Number(h.media.toFixed(1)) : null);
    const hums = historicoCronologico.map(h => h.media_umidade !== null ? Number(h.media_umidade.toFixed(1)) : null);

    const nomeAmigavel = obterNomeAmigavel(sensorObj);
    renderizarGraficoTemperaturaIndividual(labels, temps, nomeAmigavel, infoSala);

    if (!isGeladeira) {
        renderizarGraficoUmidade(labels, hums, infoSala);
    }

    montarTabelaIndividual(historicoFiltrado, nomeAmigavel, infoSala, isGeladeira);
    calcularResumoIndividual(temps, hums, infoSala, isGeladeira);
}

function mostrarEstadoVazio(sensorObj) {
    const canvasTemp = document.getElementById('grafico-temperatura');
    const avisoTempVazio = document.getElementById('aviso-grafico-temp-vazio');
    const wrapperUmid = document.getElementById('wrapper-grafico-umidade');

    if (canvasTemp) canvasTemp.style.display = 'none';
    if (wrapperUmid) wrapperUmid.style.display = 'none';
    if (avisoTempVazio) {
        avisoTempVazio.style.display = 'block';
        document.getElementById('texto-grafico-temp-vazio').innerText = 'Nenhuma medição encontrada.';
    }
    exibirTabelaVazia('Nenhum dado registrado para este sensor.');
    atualizarPainelResumo([], [], 0, 0, false);
}

// ==========================================================================
// RENDERIZAR GRÁFICO COMPARATIVO
// ==========================================================================
function renderizarGraficoTemperaturaComparativo(labels, datasets, tempMin, tempMax) {
    const ctx = document.getElementById('grafico-temperatura').getContext('2d');

    if (graficoTemp) {
        graficoTemp.data.labels = labels;
        graficoTemp.data.datasets = datasets;
        graficoTemp.update('none');
        return;
    }

    graficoTemp = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => items[0].label || '',
                        label: context => {
                            const val = context.raw;
                            if (val === null) return `${context.dataset.label}: Sem leitura`;
                            const status = (val < tempMin || val > tempMax) ? ' ⚠️ Fora do ideal' : ' ✓ Normal';
                            return ` ${context.dataset.label}: ${val.toFixed(1)} °C (${status})`;
                        }
                    }
                },
                annotation: {
                    annotations: {
                        min: {
                            type: 'line',
                            yMin: tempMin,
                            yMax: tempMin,
                            borderColor: 'rgba(239, 68, 68, 0.7)',
                            borderWidth: 1.5,
                            borderDash: [5, 5],
                            label: { enabled: true, content: `Mín: ${tempMin}°C`, position: 'start', font: { size: 10 } }
                        },
                        max: {
                            type: 'line',
                            yMin: tempMax,
                            yMax: tempMax,
                            borderColor: 'rgba(239, 68, 68, 0.7)',
                            borderWidth: 1.5,
                            borderDash: [5, 5],
                            label: { enabled: true, content: `Máx: ${tempMax}°C`, position: 'start', font: { size: 10 } }
                        }
                    }
                }
            },
            scales: {
                y: {
                    suggestedMin: Math.floor(tempMin - 2),
                    suggestedMax: Math.ceil(tempMax + 4),
                    ticks: { callback: v => `${v} °C` }
                }
            }
        }
    });
}

// ==========================================================================
// RENDERIZAR GRÁFICO INDIVIDUAL
// ==========================================================================
function renderizarGraficoTemperaturaIndividual(labels, dataTemp, nomeEquipamento, infoSala) {
    const ctx = document.getElementById('grafico-temperatura').getContext('2d');
    const { tempMin, tempMax } = infoSala;

    const pointColors = dataTemp.map(val => {
        if (val === null) return '#2563eb';
        return (val < tempMin || val > tempMax) ? '#ef4444' : '#2563eb';
    });

    const dataset = [{
        label: nomeEquipamento,
        data: dataTemp,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.08)',
        tension: 0.35,
        fill: true,
        pointBackgroundColor: pointColors,
        pointRadius: dataTemp.map(v => v !== null && (v < tempMin || v > tempMax) ? 5 : 3)
    }];

    if (graficoTemp) {
        graficoTemp.data.labels = labels;
        graficoTemp.data.datasets = dataset;
        graficoTemp.update('none');
        return;
    }

    graficoTemp = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: dataset },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => items[0].label || '',
                        label: context => {
                            const val = context.raw;
                            if (val === null) return 'Sem leitura';
                            const status = (val < tempMin || val > tempMax) ? ' ⚠️ Fora do ideal' : ' ✓ Normal';
                            return `Temperatura: ${val.toFixed(1)} °C (${status})`;
                        }
                    }
                },
                annotation: {
                    annotations: {
                        min: {
                            type: 'line',
                            yMin: tempMin,
                            yMax: tempMin,
                            borderColor: 'rgba(239, 68, 68, 0.7)',
                            borderWidth: 1.5,
                            borderDash: [5, 5],
                            label: { enabled: true, content: `Mín: ${tempMin}°C`, position: 'start', font: { size: 10 } }
                        },
                        max: {
                            type: 'line',
                            yMin: tempMax,
                            yMax: tempMax,
                            borderColor: 'rgba(239, 68, 68, 0.7)',
                            borderWidth: 1.5,
                            borderDash: [5, 5],
                            label: { enabled: true, content: `Máx: ${tempMax}°C`, position: 'start', font: { size: 10 } }
                        }
                    }
                }
            },
            scales: {
                y: {
                    suggestedMin: Math.floor(tempMin - 2),
                    suggestedMax: Math.ceil(tempMax + 4),
                    ticks: { callback: v => `${v} °C` }
                }
            }
        }
    });
}

// ==========================================================================
// RENDERIZAR GRÁFICO DE UMIDADE
// ==========================================================================
function renderizarGraficoUmidade(labels, dataHum, infoSala) {
    const ctx = document.getElementById('grafico-umidade').getContext('2d');
    const { umidMin, umidMax } = infoSala;

    const pointColors = dataHum.map(val => {
        if (val === null) return '#0284c7';
        return (val < umidMin || val > umidMax) ? '#ef4444' : '#0284c7';
    });

    const dataset = [{
        label: 'Umidade Ambiente (%)',
        data: dataHum,
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.08)',
        tension: 0.35,
        fill: true,
        pointBackgroundColor: pointColors,
        pointRadius: dataHum.map(v => v !== null && (v < umidMin || v > umidMax) ? 5 : 3)
    }];

    if (graficoUmid) {
        graficoUmid.data.labels = labels;
        graficoUmid.data.datasets = dataset;
        graficoUmid.update('none');
        return;
    }

    graficoUmid = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: dataset },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => items[0].label || '',
                        label: context => {
                            const val = context.raw;
                            if (val === null) return 'Sem leitura';
                            const status = (val < umidMin || val > umidMax) ? ' ⚠️ Fora do ideal' : ' ✓ Normal';
                            return `Umidade: ${val.toFixed(1)} % (${status})`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    suggestedMin: Math.max(0, Math.floor(umidMin - 10)),
                    suggestedMax: Math.min(100, Math.ceil(umidMax + 10)),
                    ticks: { callback: v => `${v} %` }
                }
            }
        }
    });
}

// ==========================================================================
// TABELA DE HORÁRIOS E EXPORTAÇÃO
// ==========================================================================
function montarTabelaMultiplos(resultados, infoSala) {
    dadosTabelaAtual = [];

    resultados.forEach(r => {
        const nomeAmigavel = obterNomeAmigavel(r.sensor);
        const temUmid = r.sensor.sensorType !== 'DS18B20';

        r.dadosCronologicos.forEach(d => {
            const temp = d.media !== null ? Number(d.media.toFixed(1)) : null;
            const umid = temUmid && d.media_umidade !== null ? Number(d.media_umidade.toFixed(1)) : null;

            let situacao = 'Normal';
            let fora = false;

            if (temp !== null) {
                if (temp < infoSala.tempMin) { situacao = `Temp Baixa (${temp}°C)`; fora = true; }
                if (temp > infoSala.tempMax) { situacao = `Temp Alta (${temp}°C)`; fora = true; }
            }

            dadosTabelaAtual.push({
                timestamp: d.hora,
                dataHoraFormatada: formatarDataHoraAmigavel(d.hora),
                local: nomeAmigavel,
                temperatura: temp !== null ? `${temp} °C` : '--',
                umidade: temUmid ? (umid !== null ? `${umid} %` : '--') : 'N/A',
                isConforme: !fora,
                situacao
            });
        });
    });

    renderizarTabelaHistorica();
}

function montarTabelaIndividual(historicoFiltrado, nomeEquipamento, infoSala, isGeladeira) {
    dadosTabelaAtual = historicoFiltrado.map(d => {
        const temp = d.media !== null ? Number(d.media.toFixed(1)) : null;
        const umid = !isGeladeira && d.media_umidade !== null ? Number(d.media_umidade.toFixed(1)) : null;

        let situacao = 'Normal';
        let fora = false;

        if (temp !== null) {
            if (temp < infoSala.tempMin) { situacao = `Temp Baixa (${temp}°C)`; fora = true; }
            if (temp > infoSala.tempMax) { situacao = `Temp Alta (${temp}°C)`; fora = true; }
        }

        return {
            timestamp: d.hora,
            dataHoraFormatada: formatarDataHoraAmigavel(d.hora),
            local: nomeEquipamento,
            temperatura: temp !== null ? `${temp} °C` : '--',
            umidade: !isGeladeira ? (umid !== null ? `${umid} %` : '--') : 'N/A',
            isConforme: !fora,
            situacao
        };
    });

    renderizarTabelaHistorica();
}

function renderizarTabelaHistorica() {
    const tbody = document.getElementById('tabela-historico-body');
    if (!tbody) return;

    if (!dadosTabelaAtual || dadosTabelaAtual.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="tabela-vazia">Nenhum registro para o período.</td></tr>';
        return;
    }

    const dadosOrdenados = [...dadosTabelaAtual].sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return ordemTabelaRecente ? (timeB - timeA) : (timeA - timeB);
    });

    tbody.innerHTML = '';
    dadosOrdenados.slice(0, 100).forEach(dado => {
        const tr = document.createElement('tr');
        if (!dado.isConforme) tr.className = 'linha-anomalia';

        const badgeClass = dado.isConforme ? 'badge-conforme' : 'badge-fora';
        const badgeIcon = dado.isConforme ? 'fa-check' : 'fa-triangle-exclamation';

        tr.innerHTML = `
            <td><strong>${dado.dataHoraFormatada}</strong></td>
            <td>${dado.local}</td>
            <td>${dado.temperatura}</td>
            <td>${dado.umidade}</td>
            <td>
                <span class="badge-status-tabela ${badgeClass}">
                    <i class="fa-solid ${badgeIcon}"></i> ${dado.situacao}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function exibirTabelaVazia(msg) {
    const tbody = document.getElementById('tabela-historico-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="tabela-vazia">${msg}</td></tr>`;
}

function exportarPlanilhaExcel() {
    if (!dadosTabelaAtual || dadosTabelaAtual.length === 0) {
        alert('Não há registros para baixar no período selecionado.');
        return;
    }

    let csv = 'Horario;Local / Equipamento;Temperatura;Umidade;Situacao\n';
    dadosTabelaAtual.forEach(d => {
        csv += `"${d.dataHoraFormatada}";"${d.local}";"${d.temperatura}";"${d.umidade}";"${d.situacao}"\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio_laboratorio_${salaAtual}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================================================
// RESUMO E ESTATÍSTICAS
// ==========================================================================
function calcularResumoGeral(resultados, infoSala, temUmidadeNaSala) {
    let todasTemps = [];
    let todasUmid = [];
    let total = 0;
    let conformes = 0;

    resultados.forEach(r => {
        r.dadosCronologicos.forEach(d => {
            if (d.media !== null) {
                const t = Number(d.media);
                todasTemps.push(t);
                total++;
                if (t >= infoSala.tempMin && t <= infoSala.tempMax) conformes++;
            }
            if (r.sensor.sensorType === 'DHT11' && d.media_umidade !== null) {
                todasUmid.push(Number(d.media_umidade));
            }
        });
    });

    atualizarPainelResumo(todasTemps, todasUmid, conformes, total, temUmidadeNaSala);
}

function calcularResumoIndividual(temps, hums, infoSala, isGeladeira) {
    const tempsValidos = temps.filter(t => t !== null);
    const humsValidos = isGeladeira ? [] : hums.filter(h => h !== null);

    let total = tempsValidos.length;
    let conformes = tempsValidos.filter(t => t >= infoSala.tempMin && t <= infoSala.tempMax).length;

    atualizarPainelResumo(tempsValidos, humsValidos, conformes, total, !isGeladeira);
}

function atualizarPainelResumo(temps, hums, conformes, total, temUmidade) {
    const media = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '--';
    const max = arr => arr.length ? Math.max(...arr).toFixed(1) : '--';
    const min = arr => arr.length ? Math.min(...arr).toFixed(1) : '--';

    document.getElementById('temp-media').innerText = temps.length ? `${media(temps)} °C` : '-- °C';
    document.getElementById('temp-max').innerText = temps.length ? `${max(temps)} °C` : '-- °C';
    document.getElementById('temp-min').innerText = temps.length ? `${min(temps)} °C` : '-- °C';

    const blocoUmid = document.getElementById('resumo-umidade-bloco');
    if (blocoUmid) {
        if (temUmidade && hums.length > 0) {
            blocoUmid.style.display = 'block';
            document.getElementById('umid-media').innerText = `${media(hums)} %`;
            document.getElementById('umid-max').innerText = `${max(hums)} %`;
            document.getElementById('umid-min').innerText = `${min(hums)} %`;
        } else {
            blocoUmid.style.display = 'none';
        }
    }

    const taxa = total > 0 ? Math.round((conformes / total) * 100) : '--';
    const badgeConf = document.getElementById('taxa-conformidade-badge');
    if (badgeConf) {
        if (taxa === '--') {
            badgeConf.innerText = 'Sem dados recentes';
            badgeConf.style.backgroundColor = '#f1f5f9';
            badgeConf.style.color = '#64748b';
        } else {
            badgeConf.innerText = `${taxa}% no padrão`;
            if (taxa >= 95) {
                badgeConf.style.backgroundColor = 'var(--cor-verde-fundo)';
                badgeConf.style.color = '#065f46';
            } else if (taxa >= 80) {
                badgeConf.style.backgroundColor = 'var(--cor-amarelo-fundo)';
                badgeConf.style.color = '#92400e';
            } else {
                badgeConf.style.backgroundColor = 'var(--cor-vermelho-fundo)';
                badgeConf.style.color = '#991b1b';
            }
        }
    }
}

// ==========================================================================
// FORMATAÇÕES AMIGÁVEIS E PREVENÇÃO DE ERROS DE DATA
// ==========================================================================
function obterDuracaoJanelaMs(periodo) {
    if (periodo === '6h') return 6 * 3600 * 1000;
    if (periodo === '24h') return 24 * 3600 * 1000;
    if (periodo === '7d') return 7 * 24 * 3600 * 1000;
    return 24 * 3600 * 1000;
}

function formatarLabelEixo(isoString, periodo) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const hoje = new Date();

    const mesmoDia = d.getDate() === hoje.getDate() && 
                     d.getMonth() === hoje.getMonth() && 
                     d.getFullYear() === hoje.getFullYear();

    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');

    if (mesmoDia && periodo === '6h') {
        return `${hh}:${mm}`;
    }

    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    return `${dia}/${mes} ${hh}:${mm}`;
}

function formatarDataHoraAmigavel(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes} às ${hh}:${mm}`;
}

function atualizarTextosFaixaIdeal() {
    const infoSala = salasCadastradas[salaAtual] || LIMITES_PADRAO.geladeiras;

    const legendaTemp = document.getElementById('legenda-temp-faixa');
    const resumoFaixa = document.getElementById('resumo-faixa-ideal');

    if (legendaTemp) legendaTemp.innerText = `Faixa ideal: ${infoSala.rotulo}`;
    if (resumoFaixa) resumoFaixa.innerText = infoSala.rotulo;
}
