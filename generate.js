const fs = require('fs/promises');
const nunjucks = require('nunjucks');
const OpenAI = require('openai');
require('dotenv').config();
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');

// Configurar Nunjucks
nunjucks.configure('templates', { autoescape: true });

// Configurar OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Estructura del temario
const TEMARIO = {
    "Constitución Española de 1978": [
        "Título Preliminar",
        "Los derechos y deberes fundamentales (Título Preliminar y Título I)",
        "Ley Orgánica de igualdad efectiva entre mujeres y hombres",
        "Ley Orgánica de Defensa Nacional",
        "La Corona (Título II)",
        "Las Cortes Generales (Título III)",
        "El Gobierno y la Administración (Título IV)",
        "Relaciones entre el Gobierno y las Cortes Generales (Título V)",
        "El Poder Judicial (Título VI)",
        "El Tribunal Constitucional (Título IX)",
        "La Reforma constitucional (Título X)"
    ],
    "Relaciones Internacionales y Unión Europea": [
        "Política exterior y ejes de la política exterior española",
        "España en organizaciones internacionales",
        "Los nuevos instrumentos de la política exterior",
        "Naciones Unidas: Creación, propósitos y principios",
        "Estructura: Órganos principales y subsidiarios",
        "Carta de Naciones Unidas",
        "Unión Europea: Objetivos y valores de la UE",
        "Los 27 países miembros de la UE",
        "Países que utilizan el euro",
        "Miembros del espacio Schengen sin fronteras",
        "Calendario de adhesión a la UE",
        "Instituciones y organismos de la UE",
        "Otras instituciones y organismos de la UE",
        "Organizaciones de cooperación política y militar",
        "Estructura, funciones y realizaciones del Consejo de Europa",
        "Sedes, acciones y medidas del Consejo de Europa",
        "Estados miembros, miembros fundadores, comité de ministros",
        "Asamblea parlamentaria y secretaría general",
        "OSCE: Sedes, historia, estados participantes",
        "Socios para la cooperación, residencia, cumbres",
        "Consejo permanente y consejos ministeriales",
        "Foro de cooperación en materia de seguridad",
        "OTAN: Sedes, miembros, adhesión",
        "Una alianza política y militar, tratado fundacional",
        "Decisiones y consultas, operaciones y misiones"
    ]
};

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 segundos

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryOperation(operation, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error) {
            console.error(`Error en intento ${i + 1}:`, {
                message: error.message,
                type: error.constructor.name,
                details: error.response?.data || error.response || error
            });
            
            if (i === retries - 1) throw error;
            console.log(`Intento ${i + 1} fallido, reintentando en ${RETRY_DELAY/1000} segundos...`);
            await sleep(RETRY_DELAY);
        }
    }
}

async function generateContent(topic, subtopic) {
    console.log(`    Iniciando generación de contenido para ${subtopic}`);
    return retryOperation(async () => {
        const prompt = `Genera un contenido de estudio extenso y detallado sobre "${subtopic}" dentro del tema "${topic}". 
El contenido debe incluir:
- Introducción detallada
- Desarrollo en profundidad de cada concepto
- Ejemplos prácticos
- Referencias a artículos específicos
- Jurisprudencia relevante cuando aplique
- Casos prácticos o ejemplos de aplicación
- Conclusiones
- Puntos clave a recordar

Usa formato Markdown con una estructura clara y bien organizada.
El contenido debe ser lo suficientemente extenso para cubrir todos los aspectos importantes del tema.`;
        
        console.log('    Llamando a API para contenido...');
        const completion = await openai.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: "Eres un experto en generar contenido educativo estructurado y detallado. Tu objetivo es crear contenido completo y exhaustivo que sirva como material de estudio de referencia."
                },
                { role: "user", content: prompt }
            ],
            model: "gpt-4o-mini",
            temperature: 0.7,
            max_tokens: 4000 // Aumentar el límite de tokens para contenido más extenso
        });

        console.log('    Respuesta de API recibida para contenido');
        return completion.choices[0].message.content.trim();
    });
}

// Definir el esquema de las preguntas usando Zod
const Option = z.object({
    id: z.string(),
    text: z.string()
});

const Question = z.object({
    id: z.number(),
    question: z.string(),
    options: z.array(Option),
    correctAnswer: z.string(),
    explanation: z.string()
});

const QuestionSet = z.object({
    questions: z.array(Question)
});

async function generateQuestionBatch(topic, subtopic, content, startId = 1, count = 10) {
    const contextPrompt = `
Tema principal: ${topic}
Subtema: ${subtopic}
Contenido a evaluar:
${content}`;

    const prompt = `Genera ${count} preguntas tipo test (desde la ${startId} hasta la ${startId + count - 1}) sobre el siguiente contenido.
Las preguntas deben:
- Cubrir diferentes aspectos del contenido
- Tener diferentes niveles de dificultad
- Tener explicaciones detalladas de por qué cada respuesta es correcta
- No repetir preguntas anteriores

${contextPrompt}`;
    
    console.log(`    Generando lote de preguntas ${startId}-${startId + count - 1}...`);
    
    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: "Eres un generador de preguntas tipo test. Genera las preguntas y devuelve la respuesta en formato JSON siguiendo exactamente esta estructura: { 'questions': [ { 'id': number, 'question': string, 'options': [ { 'id': string, 'text': string } ], 'correctAnswer': string, 'explanation': string } ] }"
                },
                { role: "user", content: prompt }
            ],
            model: "gpt-4o-mini",
            temperature: 0.7,
            max_tokens: 2000,
            response_format: { type: "json_object" }
        });

        const response = JSON.parse(completion.choices[0].message.content);
        console.log('    Respuesta recibida y parseada correctamente');
        
        // Validar la estructura con Zod
        const validatedQuestions = QuestionSet.parse(response);
        return validatedQuestions.questions;
    } catch (error) {
        console.error('    Error en generateQuestionBatch:', {
            name: error.name,
            message: error.message,
            response: error.response?.data
        });
        throw error;
    }
}

async function generateQuestions(topic, subtopic, content) {
    console.log(`    Iniciando generación de 50 preguntas para ${subtopic}`);
    const allQuestions = [];
    const batchSize = 10; // Generar 10 preguntas por llamada
    const totalQuestions = 50;
    
    try {
        for (let i = 0; i < totalQuestions; i += batchSize) {
            const startId = i + 1;
            const currentBatchSize = Math.min(batchSize, totalQuestions - i);
            
            console.log(`    Generando batch ${startId}-${startId + currentBatchSize - 1}...`);
            
            const questions = await retryOperation(() => 
                generateQuestionBatch(topic, subtopic, content, startId, currentBatchSize)
            );
            
            allQuestions.push(...questions);
            console.log(`    ✓ Batch ${startId}-${startId + currentBatchSize - 1} completado`);
            
            // Pequeña pausa entre batches para no sobrecargar la API
            if (i + batchSize < totalQuestions) {
                console.log('    Esperando antes del siguiente batch...');
                await sleep(1000);
            }
        }

        console.log(`    ✓ Generación completa: ${allQuestions.length} preguntas`);
        return { questions: allQuestions };
    } catch (error) {
        console.error('    ✗ Error generando preguntas:', error);
        throw error;
    }
}

async function generateSite() {
    try {
        console.log('Iniciando generación del sitio...');
        await fs.mkdir('dist', { recursive: true });
        await fs.mkdir('dist/content', { recursive: true });
        await fs.mkdir('dist/tests', { recursive: true });
        console.log('✓ Directorios creados');

        const topicsPromises = Object.entries(TEMARIO).map(async ([topic, subtopics]) => {
            console.log(`\nPreparando generación para tema: ${topic}`);
            
            const topicId = topic.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            
            const subtopicPromises = subtopics.map(async subtopic => {
                const subtopicId = subtopic.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                const fullId = `${topicId}-${subtopicId}`;

                try {
                    console.log(`  Iniciando generación para: ${subtopic}`);
                    console.log(`  ID generado: ${fullId}`);
                    
                    console.log('  Intentando usar la API...', {
                        topic,
                        subtopic
                    });
                    
                    // Primero generamos el contenido
                    const content = await retryOperation(() => generateContent(topic, subtopic));
                    console.log('  ✓ Contenido generado:', {
                        contentLength: content?.length || 0
                    });

                    // Luego generamos las preguntas usando el contenido
                    const questions = await retryOperation(() => generateQuestions(topic, subtopic, content));
                    console.log('  ✓ Preguntas generadas:', {
                        questionsCount: questions?.questions?.length || 0
                    });
                    
                    console.log('  Generando archivos...');
                    await Promise.all([
                        fs.writeFile(
                            `dist/content/${fullId}.html`,
                            nunjucks.render('content.html', { content })
                        ),
                        fs.writeFile(
                            `dist/tests/${fullId}.html`,
                            nunjucks.render('test.html', { questionsData: questions })
                        )
                    ]);

                    console.log(`  ✓ Archivos generados para: ${subtopic}`);
                    return { title: subtopic, id: fullId, success: true };
                } catch (error) {
                    console.error(`  ✗ Error procesando ${subtopic}:`, error.message);
                    console.error('  Stack:', error.stack);
                    return { title: subtopic, id: fullId, success: false };
                }
            });

            const results = await Promise.all(subtopicPromises);
            console.log(`\n✓ Tema ${topic} procesado. ${results.filter(r => r.success).length}/${results.length} subtemas exitosos`);
            
            return {
                title: topic,
                id: topicId,
                subtopics: results.filter(result => result.success)
            };
        });

        const topicsData = await Promise.all(topicsPromises);
        console.log('\nGenerando página principal...');
        
        await fs.writeFile(
            'dist/index.html',
            nunjucks.render('index.html', { topics: topicsData })
        );

        console.log('\n✓ Sitio generado exitosamente');
        console.log(`Total temas: ${topicsData.length}`);
        console.log(`Total subtemas: ${topicsData.reduce((acc, topic) => acc + topic.subtopics.length, 0)}`);
    } catch (error) {
        console.error('\n✗ Error general:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Ejecutar el generador
generateSite(); 