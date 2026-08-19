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
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

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
    let { data: torneo } = await supabase
        .from('torneos')
        .select('*')
        .eq('nombre', 'torneo_principal')
        .single();
    
    if (!torneo) {
        const { data: nuevo } = await supabase
            .from('torneos')
            .insert({ 
                nombre: 'torneo_principal',
                configuracion: { puntos_ganado: 3, puntos_empate: 1, puntos_perdido: 0 }
            })
            .select()
            .single();
        torneo = nuevo;
    }
    return torneo;
}

// ===== CALCULAR ESTADÍSTICAS =====
async function calcularEstadisticas(torneoId) {
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

    const { data: partidos } = await supabase
        .from('partidos')
        .select('*')
        .eq('torneo_id', torneoId)
        .eq('jugado', true);

    for (const p of partidos || []) {
        const equipo1 = equipos?.find(e => e.id === p.equipo1_id);
        const equipo2 = equipos?.find(e => e.id === p.equipo2_id);
        if (!equipo1 || !equipo2) continue;

        await supabase
            .from('equipos')
            .update({
                goles_favor: equipo1.goles_favor + (p.goles1 || 0),
                goles_contra: equipo1.goles_contra + (p.goles2 || 0)
            })
            .eq('id', equipo1.id);

        await supabase
            .from('equipos')
            .update({
                goles_favor: equipo2.goles_favor + (p.goles2 || 0),
                goles_contra: equipo2.goles_contra + (p.goles1 || 0)
            })
            .eq('id', equipo2.id);

        if ((p.goles1 || 0) > (p.goles2 || 0)) {
            await supabase
                .from('equipos')
                .update({
                    ganados: equipo1.ganados + 1,
                    puntos: equipo1.puntos + 3
                })
                .eq('id', equipo1.id);
            await supabase
                .from('equipos')
                .update({
                    perdidos: equipo2.perdidos + 1
                })
                .eq('id', equipo2.id);
        } else if ((p.goles2 || 0) > (p.goles1 || 0)) {
            await supabase
                .from('equipos')
                .update({
                    ganados: equipo2.ganados + 1,
                    puntos: equipo2.puntos + 3
                })
                .eq('id', equipo2.id);
            await supabase
                .from('equipos')
                .update({
                    perdidos: equipo1.perdidos + 1
                })
                .eq('id', equipo1.id);
        } else {
            await supabase
                .from('equipos')
                .update({
                    empatados: equipo1.empatados + 1,
                    puntos: equipo1.puntos + 1
                })
                .eq('id', equipo1.id);
            await supabase
                .from('equipos')
                .update({
                    empatados: equipo2.empatados + 1,
                    puntos: equipo2.puntos + 1
                })
                .eq('id', equipo2.id);
        }
    }
}

// ===== RUTAS =====

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Servidor con Supabase' });
});

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }
});

app.get('/api/torneo', async (req, res) => {
    try {
        const torneo = await getTorneoPrincipal();
        const torneoId = torneo.id;

        const { data: juveniles } = await supabase
            .from('juveniles')
            .select('*')
            .eq('torneo_id', torneoId);

        const { data: equipos } = await supabase
            .from('equipos')
            .select('*')
            .eq('torneo_id', torneoId);

        const { data: gruposRaw } = await supabase
            .from('grupos')
            .select('*')
            .eq('torneo_id', torneoId);

        const grupos = await Promise.all((gruposRaw || []).map(async (g) => {
            const { data: grupoEquipos } = await supabase
                .from('grupo_equipos')
                .select('equipo_id')
                .eq('grupo_id', g.id);
            
            const equipoIds = (grupoEquipos || []).map(ge => ge.equipo_id);
            const equiposDelGrupo = equipos.filter(e => equipoIds.includes(e.id));
            
            return {
                ...g,
                equipos: equiposDelGrupo
            };
        }));

        const { data: partidosRaw } = await supabase
            .from('partidos')
            .select('*')
            .eq('torneo_id', torneoId);

        const partidos = await Promise.all((partidosRaw || []).map(async (p) => {
            const { data: e1 } = await supabase
                .from('equipos')
                .select('nombre')
                .eq('id', p.equipo1_id)
                .single();
            const { data: e2 } = await supabase
                .from('equipos')
                .select('nombre')
                .eq('id', p.equipo2_id)
                .single();
            return {
                ...p,
                equipo1: e1?.nombre || `Equipo ${p.equipo1_id}`,
                equipo2: e2?.nombre || `Equipo ${p.equipo2_id}`
            };
        }));

        // ORDENAR: Pendientes primero, finalizados después
        partidos.sort((a, b) => {
            if (a.jugado !== b.jugado) {
                return a.jugado ? 1 : -1;
            }
            return a.id - b.id;
        });

        res.json({
            nombre: torneo.nombre,
            configuracion: torneo.configuracion || { puntos_ganado: 3, puntos_empate: 1, puntos_perdido: 0 },
            juveniles: juveniles || [],
            equipos: equipos || [],
            grupos: grupos || [],
            partidos: partidos || [],
            llaves: grupos?.[0]?.llaves || null
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/partidos/:id/resultado', verificarToken, async (req, res) => {
    const { id } = req.params;
    const { goles1, goles2 } = req.body;

    try {
        const { data: partido } = await supabase
            .from('partidos')
            .select('*')
            .eq('id', id)
            .single();

        if (!partido) {
            return res.status(404).json({ error: 'Partido no encontrado' });
        }

        let ganador = null;
        if (goles1 > goles2) {
            const { data: e1 } = await supabase
                .from('equipos')
                .select('nombre')
                .eq('id', partido.equipo1_id)
                .single();
            ganador = e1?.nombre || 'Equipo 1';
        } else if (goles2 > goles1) {
            const { data: e2 } = await supabase
                .from('equipos')
                .select('nombre')
                .eq('id', partido.equipo2_id)
                .single();
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

        await calcularEstadisticas(partido.torneo_id);

        res.json({ success: true, message: 'Resultado registrado' });
    } catch (error) {
        console.error('Error:', error);
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
            .single();

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

        res.json({ success: true, message: 'Resultado eliminado' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reiniciar', verificarToken, async (req, res) => {
    try {
        const torneo = await getTorneoPrincipal();

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

        res.json({ success: true, message: 'Resultados reiniciados' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor con Supabase en http://localhost:${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin.html`);
    console.log(`👀 Pública: http://localhost:${PORT}/index.html`);
});