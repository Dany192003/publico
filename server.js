const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'torneo_secret_2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';

// ===== CONFIGURACIÓN SUPABASE =====
console.log('🔑 Verificando variables de entorno:');
console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Configurada' : '❌ FALTA');
console.log('  SUPABASE_KEY:', process.env.SUPABASE_KEY ? '✅ Configurada' : '❌ FALTA');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ===== RUTA RAÍZ =====
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ===== VERIFICAR TOKEN =====
function verificarToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token requerido' });
    }
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido' });
    }
}

// ===== OBTENER TORNEO PRINCIPAL =====
async function getTorneoPrincipal() {
    const { data: torneo, error } = await supabase
        .from('torneos')
        .select('*')
        .eq('nombre', 'torneo_principal')
        .maybeSingle();
    
    if (error) {
        console.error('❌ Error obteniendo torneo:', error);
        return null;
    }
    
    if (!torneo) {
        console.log('⚠️ Torneo no encontrado, creando uno nuevo...');
        const { data: nuevo, error: insertError } = await supabase
            .from('torneos')
            .insert({ 
                nombre: 'torneo_principal',
                configuracion: { puntos_ganado: 3, puntos_empate: 1, puntos_perdido: 0 }
            })
            .select()
            .single();
        
        if (insertError) {
            console.error('❌ Error creando torneo:', insertError);
            return null;
        }
        console.log('✅ Torneo creado (ID:', nuevo.id, ')');
        return nuevo;
    }
    
    return torneo;
}

// ===== CALCULAR ESTADÍSTICAS =====
async function calcularEstadisticas(torneoId) {
    console.log('📊 Recalculando estadísticas...');
    
    const { data: equipos } = await supabase
        .from('equipos')
        .select('*')
        .eq('torneo_id', torneoId);

    for (const equipo of equipos || []) {
        await supabase
            .from('equipos')
            .update({
                ganados: 0,
                empatados: 0,
                perdidos: 0,
                goles_favor: 0,
                goles_contra: 0,
                puntos: 0
            })
            .eq('id', equipo.id);
    }

    const { data: partidosJugados } = await supabase
        .from('partidos')
        .select('*')
        .eq('torneo_id', torneoId)
        .eq('jugado', true);

    console.log(`   📋 Partidos jugados encontrados: ${partidosJugados?.length || 0}`);

    for (const p of partidosJugados || []) {
        const equipo1 = equipos?.find(e => e.id === p.equipo1_id);
        const equipo2 = equipos?.find(e => e.id === p.equipo2_id);
        
        if (!equipo1 || !equipo2) continue;

        const { data: e1Actual } = await supabase
            .from('equipos')
            .select('ganados, empatados, perdidos, goles_favor, goles_contra, puntos')
            .eq('id', equipo1.id)
            .single();
        
        const { data: e2Actual } = await supabase
            .from('equipos')
            .select('ganados, empatados, perdidos, goles_favor, goles_contra, puntos')
            .eq('id', equipo2.id)
            .single();

        const g1 = p.goles1 || 0;
        const g2 = p.goles2 || 0;

        await supabase
            .from('equipos')
            .update({
                goles_favor: (e1Actual?.goles_favor || 0) + g1,
                goles_contra: (e1Actual?.goles_contra || 0) + g2
            })
            .eq('id', equipo1.id);

        await supabase
            .from('equipos')
            .update({
                goles_favor: (e2Actual?.goles_favor || 0) + g2,
                goles_contra: (e2Actual?.goles_contra || 0) + g1
            })
            .eq('id', equipo2.id);

        if (g1 > g2) {
            await supabase
                .from('equipos')
                .update({
                    ganados: (e1Actual?.ganados || 0) + 1,
                    puntos: (e1Actual?.puntos || 0) + 3
                })
                .eq('id', equipo1.id);
            await supabase
                .from('equipos')
                .update({
                    perdidos: (e2Actual?.perdidos || 0) + 1
                })
                .eq('id', equipo2.id);
        } else if (g2 > g1) {
            await supabase
                .from('equipos')
                .update({
                    ganados: (e2Actual?.ganados || 0) + 1,
                    puntos: (e2Actual?.puntos || 0) + 3
                })
                .eq('id', equipo2.id);
            await supabase
                .from('equipos')
                .update({
                    perdidos: (e1Actual?.perdidos || 0) + 1
                })
                .eq('id', equipo1.id);
        } else {
            await supabase
                .from('equipos')
                .update({
                    empatados: (e1Actual?.empatados || 0) + 1,
                    puntos: (e1Actual?.puntos || 0) + 1
                })
                .eq('id', equipo1.id);
            await supabase
                .from('equipos')
                .update({
                    empatados: (e2Actual?.empatados || 0) + 1,
                    puntos: (e2Actual?.puntos || 0) + 1
                })
                .eq('id', equipo2.id);
        }
    }
    console.log('✅ Estadísticas recalculadas correctamente');
}

// ===== RUTAS DE API =====

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Servidor con Supabase' });
});

// Login
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }
});

// ===== ENDPOINT DE DIAGNÓSTICO =====
app.get('/api/diagnostico', async (req, res) => {
    console.log('🔍 Diagnóstico iniciado');
    try {
        // 1. Verificar conexión a Supabase
        const { data: test, error: testError } = await supabase
            .from('torneos')
            .select('*')
            .limit(1);
        
        if (testError) {
            console.error('❌ Error de conexión:', testError);
            return res.status(500).json({
                error: 'Error conectando a Supabase',
                details: testError.message,
                supabase_url: process.env.SUPABASE_URL ? '✅ Configurada' : '❌ FALTA',
                supabase_key: process.env.SUPABASE_KEY ? '✅ Configurada' : '❌ FALTA'
            });
        }

        // 2. Obtener torneo principal
        const torneo = await getTorneoPrincipal();
        
        if (!torneo) {
            return res.json({
                conexion: '✅ OK',
                mensaje: 'No hay torneo "torneo_principal" en la base de datos',
                torneos_disponibles: test
            });
        }

        const torneoId = torneo.id;
        console.log(`📁 Torneo encontrado: ${torneo.nombre} (ID: ${torneoId})`);

        // 3. Contar registros en cada tabla
        const { count: equiposCount } = await supabase
            .from('equipos')
            .select('*', { count: 'exact', head: true })
            .eq('torneo_id', torneoId);

        const { count: gruposCount } = await supabase
            .from('grupos')
            .select('*', { count: 'exact', head: true })
            .eq('torneo_id', torneoId);

        const { count: partidosCount } = await supabase
            .from('partidos')
            .select('*', { count: 'exact', head: true })
            .eq('torneo_id', torneoId);

        const { count: juvenilesCount } = await supabase
            .from('juveniles')
            .select('*', { count: 'exact', head: true })
            .eq('torneo_id', torneoId);

        const { count: grupoEquiposCount } = await supabase
            .from('grupo_equipos')
            .select('*', { count: 'exact', head: true });

        // 4. Obtener muestra de los datos
        const { data: equiposMuestra } = await supabase
            .from('equipos')
            .select('id, nombre')
            .eq('torneo_id', torneoId)
            .limit(3);

        const { data: gruposMuestra } = await supabase
            .from('grupos')
            .select('id, nombre')
            .eq('torneo_id', torneoId)
            .limit(3);

        res.json({
            conexion: '✅ OK',
            torneo: {
                id: torneoId,
                nombre: torneo.nombre,
                configuracion: torneo.configuracion
            },
            conteos: {
                juveniles: juvenilesCount || 0,
                equipos: equiposCount || 0,
                grupos: gruposCount || 0,
                partidos: partidosCount || 0,
                grupo_equipos: grupoEquiposCount || 0
            },
            muestra: {
                equipos: equiposMuestra || [],
                grupos: gruposMuestra || []
            },
            supabase_url: process.env.SUPABASE_URL ? '✅ Configurada' : '❌ FALTA',
            supabase_key: process.env.SUPABASE_KEY ? '✅ Configurada' : '❌ FALTA'
        });
    } catch (error) {
        console.error('❌ Error en diagnóstico:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// ===== RUTA PRINCIPAL =====
app.get('/api/torneo', async (req, res) => {
    console.log('📥 Solicitud recibida en /api/torneo');
    try {
        const torneo = await getTorneoPrincipal();
        if (!torneo) {
            return res.status(500).json({ error: 'No se pudo obtener o crear el torneo' });
        }

        const torneoId = torneo.id;
        console.log(`📁 Torneo ID: ${torneoId}`);

        // 1. Obtener juveniles
        const { data: juveniles, error: jError } = await supabase
            .from('juveniles')
            .select('*')
            .eq('torneo_id', torneoId);
        if (jError) console.error('❌ Error juveniles:', jError);
        console.log(`👥 Juveniles: ${juveniles?.length || 0}`);

        // 2. Obtener equipos
        const { data: equipos, error: eError } = await supabase
            .from('equipos')
            .select('*')
            .eq('torneo_id', torneoId);
        if (eError) console.error('❌ Error equipos:', eError);
        console.log(`🏆 Equipos: ${equipos?.length || 0}`);

        // 3. Obtener grupos
        const { data: gruposRaw, error: gError } = await supabase
            .from('grupos')
            .select('*')
            .eq('torneo_id', torneoId);
        if (gError) console.error('❌ Error grupos:', gError);
        console.log(`📋 Grupos raw: ${gruposRaw?.length || 0}`);

        // 4. Para cada grupo, obtener sus equipos desde grupo_equipos
        const grupos = await Promise.all((gruposRaw || []).map(async (g) => {
            const { data: grupoEquipos, error: geError } = await supabase
                .from('grupo_equipos')
                .select('equipo_id')
                .eq('grupo_id', g.id);
            
            if (geError) console.error(`❌ Error grupo_equipos para ${g.nombre}:`, geError);
            
            const equipoIds = (grupoEquipos || []).map(ge => ge.equipo_id);
            const equiposDelGrupo = equipos.filter(e => equipoIds.includes(e.id));
            
            console.log(`   ${g.nombre}: ${equiposDelGrupo.length} equipos`);
            return {
                ...g,
                equipos: equiposDelGrupo
            };
        }));

        // 5. Obtener partidos
        const { data: partidosRaw, error: pError } = await supabase
            .from('partidos')
            .select('*')
            .eq('torneo_id', torneoId);
        if (pError) console.error('❌ Error partidos:', pError);
        console.log(`⚽ Partidos raw: ${partidosRaw?.length || 0}`);

        // 6. Enriquecer partidos con nombres
        const partidos = await Promise.all((partidosRaw || []).map(async (p) => {
            const { data: e1 } = await supabase
                .from('equipos')
                .select('nombre')
                .eq('id', p.equipo1_id)
                .maybeSingle();
            const { data: e2 } = await supabase
                .from('equipos')
                .select('nombre')
                .eq('id', p.equipo2_id)
                .maybeSingle();
            return {
                ...p,
                equipo1: e1?.nombre || `Equipo ${p.equipo1_id}`,
                equipo2: e2?.nombre || `Equipo ${p.equipo2_id}`
            };
        }));

        // 7. Ordenar partidos: finalizados primero, pendientes después
        partidos.sort((a, b) => {
            if (a.jugado !== b.jugado) {
                return a.jugado ? -1 : 1;
            }
            return a.id - b.id;
        });

        // 8. Respuesta final
        const response = {
            nombre: torneo.nombre,
            configuracion: torneo.configuracion || { puntos_ganado: 3, puntos_empate: 1, puntos_perdido: 0 },
            juveniles: juveniles || [],
            equipos: equipos || [],
            grupos: grupos || [],
            partidos: partidos || [],
            llaves: grupos?.[0]?.llaves || null
        };

        console.log(`📤 Enviando respuesta: ${response.grupos.length} grupos, ${response.partidos.length} partidos`);
        res.json(response);

    } catch (error) {
        console.error('❌ Error en /api/torneo:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// ===== EVENTOS EN TIEMPO REAL (SSE) =====
const sseClients = [];

function notificarCambios(tabla, evento, data = null) {
    const message = JSON.stringify({ table, event: evento, data });
    console.log(`📡 Notificando ${sseClients.length} clientes: ${tabla} - ${evento}`);
    sseClients.forEach(client => {
        try {
            client.res.write(`data: ${message}\n\n`);
        } catch (error) {
            console.error('❌ Error notificando cliente:', error);
            const index = sseClients.indexOf(client);
            if (index !== -1) {
                sseClients.splice(index, 1);
            }
        }
    });
}

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const clientId = Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const client = { id: clientId, res };
    sseClients.push(client);
    console.log(`📡 Cliente ${clientId} conectado (Total: ${sseClients.length})`);

    res.write(`data: ${JSON.stringify({ event: 'connected', clientId })}\n\n`);

    const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 30000);

    req.on('close', () => {
        clearInterval(keepAlive);
        const index = sseClients.findIndex(c => c.id === clientId);
        if (index !== -1) {
            sseClients.splice(index, 1);
            console.log(`📡 Cliente ${clientId} desconectado (Total: ${sseClients.length})`);
        }
        res.end();
    });
});

// ===== RUTAS PROTEGIDAS =====

app.post('/api/partidos/:id/resultado', verificarToken, async (req, res) => {
    const { id } = req.params;
    const { goles1, goles2 } = req.body;

    if (goles1 === undefined || goles2 === undefined) {
        return res.status(400).json({ error: 'Goles son requeridos' });
    }

    console.log(`⚽ Registrando resultado para partido ${id}: ${goles1} - ${goles2}`);

    try {
        const { data: partido } = await supabase
            .from('partidos')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (!partido) {
            return res.status(404).json({ error: 'Partido no encontrado' });
        }

        let ganador = null;
        if (goles1 > goles2) {
            const { data: e1 } = await supabase
                .from('equipos')
                .select('nombre')
                .eq('id', partido.equipo1_id)
                .maybeSingle();
            ganador = e1?.nombre || 'Equipo 1';
        } else if (goles2 > goles1) {
            const { data: e2 } = await supabase
                .from('equipos')
                .select('nombre')
                .eq('id', partido.equipo2_id)
                .maybeSingle();
            ganador = e2?.nombre || 'Equipo 2';
        } else {
            ganador = 'Empate';
        }

        await supabase
            .from('partidos')
            .update({
                goles1,
                goles2,
                ganador,
                jugado: true,
                en_vivo: false
            })
            .eq('id', id);

        console.log(`   ✅ Partido ${id} actualizado`);

        await calcularEstadisticas(partido.torneo_id);

        notificarCambios('partidos', 'UPDATE', { partidoId: id });
        notificarCambios('equipos', 'UPDATE');

        const { data: partidoActualizado } = await supabase
            .from('partidos')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        const { data: e1 } = await supabase
            .from('equipos')
            .select('nombre')
            .eq('id', partidoActualizado?.equipo1_id)
            .maybeSingle();
        const { data: e2 } = await supabase
            .from('equipos')
            .select('nombre')
            .eq('id', partidoActualizado?.equipo2_id)
            .maybeSingle();

        res.json({
            success: true,
            message: 'Resultado registrado',
            partido: {
                ...partidoActualizado,
                equipo1: e1?.nombre,
                equipo2: e2?.nombre
            }
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/partidos/:id/en_vivo', verificarToken, async (req, res) => {
    const { id } = req.params;
    const { en_vivo } = req.body;

    try {
        await supabase
            .from('partidos')
            .update({ en_vivo })
            .eq('id', id);

        notificarCambios('partidos', 'UPDATE', { partidoId: id });

        res.json({ success: true, message: `Partido ${en_vivo ? 'en vivo' : 'finalizado'}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/partidos/:id/resultado', verificarToken, async (req, res) => {
    const { id } = req.params;

    try {
        const { data: partido } = await supabase
            .from('partidos')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (!partido) {
            return res.status(404).json({ error: 'Partido no encontrado' });
        }

        await supabase
            .from('partidos')
            .update({
                goles1: null,
                goles2: null,
                ganador: null,
                jugado: false,
                en_vivo: false
            })
            .eq('id', id);

        await calcularEstadisticas(partido.torneo_id);

        notificarCambios('partidos', 'UPDATE', { partidoId: id });
        notificarCambios('equipos', 'UPDATE');

        res.json({ success: true, message: 'Resultado eliminado' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reiniciar', verificarToken, async (req, res) => {
    try {
        const torneo = await getTorneoPrincipal();
        if (!torneo) {
            return res.status(404).json({ error: 'Torneo no encontrado' });
        }
        console.log(`🔄 Reiniciando torneo ${torneo.nombre} (ID: ${torneo.id})`);

        await supabase
            .from('partidos')
            .update({
                goles1: null,
                goles2: null,
                ganador: null,
                jugado: false,
                en_vivo: false
            })
            .eq('torneo_id', torneo.id);
        
        console.log('   ✅ Partidos reiniciados');

        await supabase
            .from('equipos')
            .update({
                ganados: 0,
                empatados: 0,
                perdidos: 0,
                goles_favor: 0,
                goles_contra: 0,
                puntos: 0
            })
            .eq('torneo_id', torneo.id);
        
        console.log('   ✅ Estadísticas de equipos reiniciadas');

        notificarCambios('partidos', 'REINICIAR');
        notificarCambios('equipos', 'REINICIAR');

        res.json({ success: true, message: 'Todos los resultados reiniciados' });
    } catch (error) {
        console.error('❌ Error en reiniciar:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== RUTA PARA CUALQUIER OTRA URL =====
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API endpoint no encontrado' });
    }
    res.sendFile(__dirname + '/index.html');
});

// ===== INICIAR SERVIDOR =====
app.listen(PORT, () => {
    console.log(`🚀 Servidor con Supabase en http://localhost:${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin.html`);
    console.log(`👀 Pública: http://localhost:${PORT}/index.html`);
});