// Configuração da API
const API_URL = 'https://api.thalesgmartins.com.br'; 

let sensoresAtuais = [];

document.addEventListener('DOMContentLoaded', () => {
    carregarSensores();
    
    // Escuta o envio do formulário
    const form = document.getElementById('sensor-form');
    if (form) {
        form.addEventListener('submit', salvarSensor);
    }
});

// --- FUNÇÕES PRINCIPAIS ---

// 1. Carregar lista de sensores
async function carregarSensores() {
    try {
        const res = await fetch(`${API_URL}/sensores`);
        if(!res.ok) throw new Error("Erro ao buscar sensores");
        
        sensoresAtuais = await res.json();
        renderizarTabela(sensoresAtuais);
    } catch (error) {
        console.error(error);
        const tbody = document.getElementById('lista-sensores-body');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Erro ao carregar sensores. Verifique a API.</td></tr>';
        }
    }
}

// 2. Renderizar linhas da tabela
function renderizarTabela(sensores) {
    const tbody = document.getElementById('lista-sensores-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!Array.isArray(sensores) || sensores.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Nenhum sensor cadastrado.</td></tr>';
        return;
    }

    sensores.forEach(s => {
        const tr = document.createElement('tr');
        const isAtivo = s.status === 'Ativado';
        const statusClass = isAtivo ? 'badge-ativo' : 'badge-inativo';

        // Formatação dos limites
        const isGeladeira = s.sensorType === 'DS18B20' || (s.sensorName || '').toLowerCase().includes('geladeira');
        const tMin = s.tempMin !== null && s.tempMin !== undefined ? s.tempMin : (isGeladeira ? 2.0 : 18.0);
        const tMax = s.tempMax !== null && s.tempMax !== undefined ? s.tempMax : (isGeladeira ? 8.0 : 24.0);
        const uMin = s.umidMin !== null && s.umidMin !== undefined ? s.umidMin : (isGeladeira ? null : 40.0);
        const uMax = s.umidMax !== null && s.umidMax !== undefined ? s.umidMax : (isGeladeira ? null : 60.0);

        let textoLimites = `${tMin}°C a ${tMax}°C`;
        if (uMin !== null && uMax !== null) {
            textoLimites += ` (${uMin}% a ${uMax}%)`;
        }

        // Botão de ação (se desativado, permite reativar; se ativo, permite desativar)
        const btnStatusAcao = isAtivo 
            ? `<button class="action-btn delete-btn" onclick="deletarSensor(${s.id})" title="Desativar Sensor">
                    <i class="mdi mdi-power"></i>
               </button>`
            : `<button class="action-btn" style="color: #00be6e;" onclick="reativarSensor(${s.id})" title="Reativar Sensor">
                    <i class="mdi mdi-play-circle"></i>
               </button>`;

        tr.innerHTML = `
            <td><strong>${escapeHtml(s.sensorName)}</strong></td>
            <td>${escapeHtml(s.sensorType || '-')}</td>
            <td>${escapeHtml(s.sala || '-')}</td>
            <td><small style="color: #475569; font-weight: 500;">${escapeHtml(textoLimites)}</small></td>
            <td><span class="badge ${statusClass}">${escapeHtml(s.status)}</span></td>
            <td>
                <button class="action-btn edit-btn" onclick="preencherEdicaoPorId(${s.id})" title="Editar">
                    <i class="mdi mdi-pencil"></i>
                </button>
                ${btnStatusAcao}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 3. Salvar (Criar ou Editar)
async function salvarSensor(event) {
    event.preventDefault();

    const id = document.getElementById('sensor-id').value;
    const payload = {
        sensorName: document.getElementById('sensor-name').value.trim(),
        sensorType: document.getElementById('sensor-type').value,
        uniqueAddress: document.getElementById('unique-address').value.trim(),
        sala: document.getElementById('sala').value.trim(),
        tempMin: document.getElementById('temp-min').value ? Number(document.getElementById('temp-min').value) : null,
        tempMax: document.getElementById('temp-max').value ? Number(document.getElementById('temp-max').value) : null,
        umidMin: document.getElementById('umid-min').value ? Number(document.getElementById('umid-min').value) : null,
        umidMax: document.getElementById('umid-max').value ? Number(document.getElementById('umid-max').value) : null,
        status: 'Ativado'
    };

    try {
        let url = `${API_URL}/sensores`;
        let method = 'POST';

        if (id) {
            url = `${API_URL}/sensores/${id}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Falha ao salvar');

        alert(id ? 'Sensor atualizado com sucesso!' : 'Novo sensor cadastrado com sucesso!');
        limparFormulario();
        carregarSensores();

    } catch (error) {
        console.error(error);
        alert('Erro ao salvar sensor. Verifique se o nome ou endereço já não estão cadastrados.');
    }
}

// 4. Preencher formulário para edição por ID
function preencherEdicaoPorId(id) {
    const sensor = sensoresAtuais.find(s => s.id === id);
    if (!sensor) return;

    document.getElementById('sensor-id').value = sensor.id;
    document.getElementById('sensor-name').value = sensor.sensorName || '';
    document.getElementById('sensor-type').value = sensor.sensorType || 'DHT22';
    document.getElementById('unique-address').value = sensor.uniqueAddress || '';
    document.getElementById('sala').value = sensor.sala || '';
    
    document.getElementById('temp-min').value = sensor.tempMin !== null && sensor.tempMin !== undefined ? sensor.tempMin : '';
    document.getElementById('temp-max').value = sensor.tempMax !== null && sensor.tempMax !== undefined ? sensor.tempMax : '';
    document.getElementById('umid-min').value = sensor.umidMin !== null && sensor.umidMin !== undefined ? sensor.umidMin : '';
    document.getElementById('umid-max').value = sensor.umidMax !== null && sensor.umidMax !== undefined ? sensor.umidMax : '';

    const titulo = document.querySelector('.form-title');
    if (titulo) {
        titulo.innerText = `Editar Sensor #${sensor.id} (${sensor.sensorName})`;
    }

    document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth' });
}

// 5. Desativar Sensor
async function deletarSensor(id) {
    if (!confirm('Deseja realmente desativar este sensor? Ele deixará de monitorar alertas.')) return;

    try {
        const res = await fetch(`${API_URL}/sensores/${id}`, {
            method: 'DELETE'
        });

        if (!res.ok) throw new Error('Erro ao desativar');

        carregarSensores();
    } catch (error) {
        console.error(error);
        alert('Erro ao tentar desativar o sensor.');
    }
}

// 6. Reativar Sensor
async function reativarSensor(id) {
    const sensor = sensoresAtuais.find(s => s.id === id);
    if (!sensor) return;

    try {
        const payload = {
            ...sensor,
            status: 'Ativado'
        };

        const res = await fetch(`${API_URL}/sensores/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Erro ao reativar');

        carregarSensores();
    } catch (error) {
        console.error(error);
        alert('Erro ao tentar reativar o sensor.');
    }
}

// 7. Limpar Formulário
function limparFormulario() {
    document.getElementById('sensor-form').reset();
    document.getElementById('sensor-id').value = '';
    const titulo = document.querySelector('.form-title');
    if (titulo) {
        titulo.innerText = 'Adicionar / Editar Sensor';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Expõe as funções globais para o HTML poder chamar via onclick
window.preencherEdicaoPorId = preencherEdicaoPorId;
window.deletarSensor = deletarSensor;
window.reativarSensor = reativarSensor;
window.limparFormulario = limparFormulario;