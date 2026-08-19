// migrar.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const fs = require('fs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function migrarDatos() {
    console.log('📂 Leyendo Hombres.json...');
    
    if (!fs.existsSync('Hombres.json')) {
        console.error('❌ No se encontró Hombres.json');
        return;
    }
    
    const data = JSON.parse(fs.readFileSync('Hombres.json', 'utf8'));

    // 1. Crear torneo principal
    console.log('📁 Creando torneo...');
    
    await supabase.from('torneos').delete().eq('nombre', 'torneo_principal');
    
    const { data: nuevoTorneo, error: torneoError } = await supabase
        .from('torneos')
        .insert({
            nombre: 'torneo_principal',
            configuracion: data.configuracion || { puntos_ganado: 3, puntos_empate: 1, puntos_perdido: 0 }
        })
        .select()
        .single();
    
    if (torneoError) {
        console.error('❌ Error creando torneo:', torneoError);
        return;
    }
    const torneoId = nuevoTorneo.id;
    console.log(`   ✅ Torneo creado (ID: ${torneoId})`);

    // 2. Migrar juveniles
    console.log('👥 Migrando juveniles...');
    const juvenilesMap = {};
    for (const j of data.juveniles || []) {
        const { data: nuevo, error } = await supabase
            .from('juveniles')
            .insert({ nombre: j.nombre, torneo_id: torneoId })
            .select()
            .single();
        
        if (error) {
            console.error(`   ❌ Error migrando juvenil ${j.nombre}:`, error.message);
            continue;
        }
        juvenilesMap[j.id] = nuevo.id;
        console.log(`   ✅ ${j.nombre} → ID ${nuevo.id}`);
    }

    // 3. Migrar equipos
    console.log('🏆 Migrando equipos...');
    const equiposMap = {};
    for (const e of data.equipos || []) {
        const { data: nuevo, error } = await supabase
            .from('equipos')
            .insert({
                nombre: e.nombre,
                juvenil_id: juvenilesMap[e.juvenil_id] || null,
                torneo_id: torneoId,
                ganados: e.ganados || 0,
                empatados: e.empatados || 0,
                perdidos: e.perdidos || 0,
                goles_favor: e.goles_favor || 0,
                goles_contra: e.goles_contra || 0,
                puntos: e.puntos || 0
            })
            .select()
            .single();
        
        if (error) {
            console.error(`   ❌ Error migrando equipo ${e.nombre}:`, error.message);
            continue;
        }
        equiposMap[e.id] = nuevo.id;
        console.log(`   ✅ ${e.nombre} → ID ${nuevo.id}`);
    }

    // 4. Migrar jugadores
    console.log('👤 Migrando jugadores...');
    let jugadoresMigrados = 0;
    for (const e of data.equipos || []) {
        for (const j of e.jugadores || []) {
            const { data: nuevo, error } = await supabase
                .from('jugadores')
                .insert({
                    nombre: j.nombre,
                    equipo_id: equiposMap[e.id]
                })
                .select()
                .single();
            
            if (error) {
                console.error(`   ❌ Error migrando jugador ${j.nombre}:`, error.message);
                continue;
            }
            jugadoresMigrados++;
        }
    }
    console.log(`   ✅ ${jugadoresMigrados} jugadores migrados`);

    // 5. Migrar grupos Y asignar equipos
    console.log('📋 Migrando grupos y asignando equipos...');
    const gruposMap = {};
    for (const g of data.grupos || []) {
        const { data: nuevoGrupo, error: grupoError } = await supabase
            .from('grupos')
            .insert({
                nombre: g.nombre,
                torneo_id: torneoId,
                llaves: data.llaves || null
            })
            .select()
            .single();
        
        if (grupoError) {
            console.error(`   ❌ Error migrando grupo ${g.nombre}:`, grupoError.message);
            continue;
        }
        gruposMap[g.nombre] = nuevoGrupo.id;
        console.log(`   ✅ ${g.nombre} → ID ${nuevoGrupo.id}`);
        
        for (const equipoData of g.equipos || []) {
            const equipoId = equiposMap[equipoData.id];
            if (!equipoId) {
                console.log(`   ⚠️ Equipo ${equipoData.nombre} no encontrado, saltando...`);
                continue;
            }
            
            const { error: assignError } = await supabase
                .from('grupo_equipos')
                .insert({
                    grupo_id: nuevoGrupo.id,
                    equipo_id: equipoId
                });
            
            if (assignError) {
                console.error(`   ❌ Error asignando equipo ${equipoData.nombre} al grupo:`, assignError.message);
            } else {
                console.log(`   ✅ ${equipoData.nombre} → asignado a ${g.nombre}`);
            }
        }
    }

    // 6. Migrar partidos
    console.log('⚽ Migrando partidos...');
    let partidosMigrados = 0;
    for (const p of data.partidos || []) {
        const equipo1Id = equiposMap[p.equipo1];
        const equipo2Id = equiposMap[p.equipo2];
        
        if (!equipo1Id || !equipo2Id) {
            console.log(`   ⚠️ Partido ${p.id}: equipo no encontrado, saltando...`);
            continue;
        }

        const { data: nuevo, error } = await supabase
            .from('partidos')
            .insert({
                equipo1_id: equipo1Id,
                equipo2_id: equipo2Id,
                grupo: p.grupo,
                etapa: p.etapa || 'grupos',
                goles1: p.goles1 || null,
                goles2: p.goles2 || null,
                ganador: p.ganador || null,
                jugado: p.jugado || false,
                en_vivo: p.en_vivo || false,
                torneo_id: torneoId
            })
            .select()
            .single();
        
        if (error) {
            console.error(`   ❌ Error migrando partido ${p.id}:`, error.message);
            continue;
        }
        partidosMigrados++;
    }
    console.log(`   ✅ ${partidosMigrados} partidos migrados`);

    console.log('\n🎉 ¡MIGRACIÓN COMPLETADA!');
    console.log(`📊 Resumen:`);
    console.log(`   - Torneo: ${data.nombre} (ID: ${torneoId})`);
    console.log(`   - Juveniles: ${Object.keys(juvenilesMap).length}`);
    console.log(`   - Equipos: ${Object.keys(equiposMap).length}`);
    console.log(`   - Grupos: ${Object.keys(gruposMap).length}`);
    console.log(`   - Partidos: ${partidosMigrados}`);
    console.log(`   - Jugadores: ${jugadoresMigrados}`);
}

migrarDatos().catch(console.error);