import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import session from "express-session";
import bcrypt from "bcrypt";
import bodyParser from "body-parser";
import cors from "cors";
import { OpenAI } from "openai";
import pool from "./db.js";
import fs from 'fs';
import multer from 'multer';
import sanitizeHtml from 'sanitize-html';
import { extractTextFromFile } from './extractTextFromFile.js';

// --- APLINKOS KONFIGŪRACIJA ---
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- MULTER KONFIGŪRACIJA ---
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 15 * 1024 * 1024 // 15 MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'application/pdf',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png'
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            const error = new Error('Netinkamas failo formatas. Leidžiami tik PDF, DOCX, TXT, JPG, PNG failai.');
            error.status = 400;
            cb(error, false);
        }
    }
});

// --- BENDRA KONFIGŪRACIJA ---
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());
app.use(express.json());

// --- SESIJOS KONFIGŪRACIJA ---
app.use(session({
  secret: 'pakeiskite_i_savo_labai_slapta_ir_ilga_rakta_2025_v4_final', // BŪTINAI PAKEISKITE Į UNIKALŲ RAKTĄ
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Gamybinėje aplinkoje su HTTPS nustatykite į 'true'
}));


//======================================================================
//  1. VIEŠI MARŠRUTAI (NEREIKIA PRISIJUNGIMO)
//======================================================================

app.use(express.static(path.join(__dirname, 'public')));

app.post("/register", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Reikia el. pašto ir slaptažodžio." });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO users (email, password, uuid) VALUES ($1, $2, uuid_generate_v4())", [email, hashedPassword]);
        res.status(201).json({ message: "Registracija sėkminga! Jūsų paskyra bus aktyvuota, kai ją patvirtins administratorius." });
    } catch (error) {
        if (error.code === '23505') {
            res.status(409).json({ error: "Toks el. paštas jau egzistuoja." });
        } else {
            console.error("Klaida registruojant:", error.message);
            res.status(500).json({ error: "Serverio klaida." });
        }
    }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Reikia el. pašto ir slaptažodžio." });
    }
    try {
        const result = await pool.query("SELECT id, uuid, password, is_approved, is_admin FROM users WHERE email = $1", [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Neteisingi prisijungimo duomenys." });
        }
        const user = result.rows[0];

        if (!user.is_approved) {
            return res.status(401).json({ error: "Jūsų paskyra dar nepatvirtinta administratoriaus." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Neteisingi prisijungimo duomenys." });
        }

        req.session.userId = user.id;
        req.session.userEmail = email;
        req.session.userUuid = user.uuid;

        res.status(200).json({ message: "Prisijungimas sėkmingas." });
    } catch (error) {
        console.error("Prisijungimo klaida:", error.message);
        res.status(500).json({ error: "Serverio klaida." });
    }
});


//======================================================================
//  2. AUTENTIFIKACIJOS PATIKRINIMAS (MIDDLEWARE)
//======================================================================

const checkAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        next();
    } else {
        res.redirect('/auth.html');
    }
};

const checkAdmin = async (req, res, next) => {
    try {
        const userId = req.session.userId;
        const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
        if (result.rows.length > 0 && result.rows[0].is_admin) {
            next();
        } else {
            res.status(403).send('Prieiga draudžiama. Ši sritis skirta tik administratoriams.');
        }
    } catch (error) {
        console.error("Admin patikrinimo klaida:", error);
        res.status(500).send('Serverio klaida tikrinant administratoriaus teises.');
    }
};


//======================================================================
//  3. PRIVATŪS MARŠRUTAI (REIKIA PRISIJUNGIMO)
//======================================================================

app.get("/", checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'protected', 'index.html'));
});

app.use(checkAuth, express.static(path.join(__dirname, 'protected')));

app.post("/logout", checkAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Klaida atsijungiant:", err);
      return res.status(500).json({ error: "Nepavyko atsijungti." });
    }
    res.clearCookie("connect.sid");
    res.status(200).json({ message: "Atsijungta sėkmingai." });
  });
});

// --- PRIVATŪS API MARŠRUTAI ---

app.get("/conversations", checkAuth, async (req, res) => {
    const userUUID = req.session.userUuid;
    if (!userUUID) {
        return res.status(401).json({ error: "Vartotojas neautentifikuotas." });
    }
    try {
        const result = await pool.query(
            "SELECT id, title FROM conversations WHERE user_uuid = $1 ORDER BY updated_at DESC",
            [userUUID]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Klaida gaunant pokalbių sąrašą:", error.message);
        res.status(500).json({ error: "Įvyko serverio klaida." });
    }
});

app.get("/conversations/:id", checkAuth, async (req, res) => {
  const { id } = req.params;
  const userUUID = req.session.userUuid;
  try {
    const convCheck = await pool.query("SELECT id FROM conversations WHERE id = $1 AND user_uuid = $2", [id, userUUID]);
    if (convCheck.rows.length === 0) {
        return res.status(403).json({ error: "Prieiga draudžiama." });
    }
    const result = await pool.query("SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC", [id]);
    res.json(result.rows);
  } catch (error) {
    console.error(`Klaida gaunant pokalbio ${id} žinutes:`, error.message);
    res.status(500).json({ error: "Įvyko serverio klaida." });
  }
});

app.patch("/conversations/:id", checkAuth, async (req, res) => {
    const { id } = req.params;
    const { title } = req.body;
    if (!title) {
        return res.status(400).json({ error: "Trūksta naujo pavadinimo." });
    }
    const sanitizedTitle = sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} });
    try {
        await pool.query("UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2", [sanitizedTitle, id]);
        res.status(200).json({ message: "Pokalbis sėkmingai pervadintas." });
    } catch (error) {
        console.error(`Klaida pervadinant pokalbį ${id}:`, error.message);
        res.status(500).json({ error: "Įvyko serverio klaida." });
    }
});

app.delete("/conversations/:id", checkAuth, async (req, res) => {
    const { id } = req.params;
    const result = await deleteConversation(id);
    if (result.success) {
        res.status(200).json({ message: "Pokalbis sėkmingai ištrintas." });
    } else {
        res.status(500).json({ error: "Įvyko serverio klaida trinant pokalbį." });
    }
});

app.post("/upload", checkAuth, upload.single('document'), async (req, res) => {
    const { conversationId } = req.body;
    if (!req.file) return res.status(400).send({ error: 'Failas nebuvo įkeltas.' });

    if (!conversationId || conversationId === 'null') {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Norėdami įkelti failą, pirmiausia pradėkite pokalbį.' });
    }
    try {
        await pool.query(
            `INSERT INTO uploaded_documents (conversation_id, original_filename, stored_filename, filepath, mimetype, filesize)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [conversationId, req.file.originalname, req.file.filename, req.file.path, req.file.mimetype, req.file.size]
        );
        res.status(200).json({
            message: "Failas sėkmingai įkeltas ir susietas su pokalbiu.",
            filename: req.file.originalname
        });
    } catch (error) {
        console.error("Klaida įkeliant failą:", error.message);
        res.status(500).json({ error: "Serverio klaida įkeliant failą." });
    }
});

app.post("/ask", checkAuth, upload.array('documents', 5), async (req, res) => {
    const { message, conversation_id } = req.body;
    const sanitizedMessage = sanitizeHtml(message, { allowedTags: [], allowedAttributes: {} });

    if (!sanitizedMessage && (!req.files || req.files.length === 0)) {
        return res.status(400).json({ reply: "Klaida: pranešimas ir failai negali būti tušti." });
    }

    let convId = conversation_id;
    let isNewConversation = false;
    const userUUID = req.session.userUuid;

    try {
        if (!userUUID) {
            return res.status(401).json({ error: "Vartotojas neautentifikuotas arba sesija baigėsi." });
        }

        if (isMemoryCommand(sanitizedMessage)) {
            const infoToRemember = extractMemoryContent(sanitizedMessage);
            if (infoToRemember) {
                await updateUserMemory(userUUID, infoToRemember);
                
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.flushHeaders();
                res.write(`data: ${JSON.stringify({ content: "Gerai, įsiminiau.", conversation_id: convId })}\n\n`);
                res.write('data: [DONE]\n\n');
                return res.end();
            }
        }

        const memoryContent = await getUserMemory(userUUID);

        if (!convId || convId === 'null') {
            isNewConversation = true;
            const defaultAssistantRes = await pool.query("SELECT id FROM assistants ORDER BY created_at ASC LIMIT 1");
            if (defaultAssistantRes.rows.length === 0) return res.status(500).json({ error: "Nėra sukurta jokių asistentų." });
            const defaultAssistantId = defaultAssistantRes.rows[0].id;
            const title = "Naujas pokalbis...";

            const newConv = await pool.query(
                "INSERT INTO conversations (title, assistant_id, user_uuid) VALUES ($1, $2, $3) RETURNING id",
                [title, defaultAssistantId, userUUID]
            );
            convId = newConv.rows[0].id;
        }

        if (sanitizedMessage) {
            await pool.query(
                "INSERT INTO messages (conversation_id, role, content, user_uuid) VALUES ($1, 'user', $2, $3)",
                [convId, sanitizedMessage, userUUID]
            );
        }

        let fileContext = "";
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await pool.query(
                    `INSERT INTO uploaded_documents (conversation_id, original_filename, stored_filename, filepath, mimetype, filesize)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [convId, file.originalname, file.filename, file.path, file.mimetype, file.size]
                );
                try {
                    const extractedText = await extractTextFromFile(file.path, file.mimetype);
                    if (extractedText) {
                        fileContext += `\n\n--- Dokumento "${file.originalname}" turinys ---\n${extractedText}\n--- Dokumento pabaiga ---`;
                    }
                } catch (extractError) {
                    console.error(`Nepavyko ištraukti teksto iš ${file.originalname}:`, extractError.message);
                }
            }
        }

        const messagesRes = await pool.query("SELECT role, content FROM messages WHERE conversation_id = $1 AND content IS NOT NULL ORDER BY created_at ASC LIMIT 200", [convId]);
        const chatHistory = messagesRes.rows.map(row => ({ role: row.role, content: row.content }));

        if (fileContext) {
            if (chatHistory.length === 0 || chatHistory[chatHistory.length - 1].role !== 'user') {
                 chatHistory.push({ role: 'user', content: fileContext.trim() });
            } else {
                chatHistory[chatHistory.length - 1].content += fileContext;
            }
        }

        const systemPromptRes = await pool.query("SELECT a.system_prompt FROM assistants a JOIN conversations c ON a.id = c.assistant_id WHERE c.id = $1", [convId]);
        const systemPrompt = systemPromptRes.rows[0]?.system_prompt || "Tu esi draugiškas AI pagalbininkas.";
        chatHistory.unshift({ role: "system", content: systemPrompt });

        if (memoryContent && memoryContent.trim() !== '') {
            chatHistory.unshift({
                role: 'system',
                content: `Tai yra ilgalaikė informacija apie vartotoją, į kurią privalai atsižvelgti: ${memoryContent}`,
            });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const completionStream = await openai.chat.completions.create({ model: "gpt-4o", messages: chatHistory, stream: true });

        let fullReply = "";
        for await (const chunk of completionStream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                fullReply += content;
                res.write(`data: ${JSON.stringify({ content, conversation_id: convId })}\n\n`);
            }
        }

        if (fullReply) {
            const inserted = await pool.query(
                "INSERT INTO messages (conversation_id, role, content, user_uuid) VALUES ($1, 'assistant', $2, $3) RETURNING id",
                [convId, fullReply, userUUID]
            );
            try {
                const embeddingRes = await openai.embeddings.create({ model: "text-embedding-ada-002", input: fullReply });
                const vector = embeddingRes?.data?.[0]?.embedding;
                if (vector && Array.isArray(vector)) {
                    await pool.query("UPDATE messages SET embedding = $1 WHERE id = $2", [JSON.stringify(vector), inserted.rows[0].id]);
                }
            } catch (embeddingError) {
                console.error("Klaida generuojant embedding'ą:", embeddingError.message);
            }
            await pool.query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [convId]);

            if (isNewConversation && (sanitizedMessage || (req.files && req.files.length > 0))) {
                const newTitle = await generateAndSaveTitle(convId, sanitizedMessage, fullReply);
                if (newTitle) {
                    res.write(`data: ${JSON.stringify({ event: 'title_updated', title: newTitle })}\n\n`);
                }
            }
        }
        
        res.write('data: [DONE]\n\n');
        res.end();

        if (isNewConversation) {
            const oldestConvRes = await pool.query("SELECT id FROM conversations WHERE user_uuid = $1 ORDER BY created_at ASC OFFSET 500 LIMIT 1", [userUUID]);
            if (oldestConvRes.rows.length > 0) {
                await deleteConversation(oldestConvRes.rows[0].id);
            }
        }

    } catch (error) {
        console.error("Klaida /ask maršrute:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ reply: "Įvyko klaida. Bandykite vėliau." });
        } else {
            res.end();
        }
    }
});


app.post("/search", checkAuth, async (req, res) => {
    const { query } = req.body;
    if (!query) {
        return res.status(400).json({ error: "Trūksta paieškos užklausos." });
    }
    try {
        const embeddingResponse = await openai.embeddings.create({ model: "text-embedding-ada-002", input: query });
        const queryEmbedding = embeddingResponse?.data?.[0]?.embedding;
        if (!queryEmbedding) {
            throw new Error('Nepavyko gauti "embedding" vektoriaus iš OpenAI API.');
        }
        const result = await pool.query(
            `SELECT content, role, created_at, conversation_id FROM messages WHERE embedding IS NOT NULL ORDER BY embedding <#> $1 LIMIT 5`,
            [JSON.stringify(queryEmbedding)]
        );
        res.json({ matches: result.rows });
    } catch (error) {
        console.error("Paieškos klaida:", error.message);
        res.status(500).json({ error: "Įvyko klaida vykdant paiešką." });
    }
});

app.post("/analyze", checkAuth, async (req, res) => {
    const { documentId } = req.body;
    if (!documentId) {
        return res.status(400).json({ error: "Trūksta dokumento ID." });
    }
    try {
        const fileResult = await pool.query("SELECT filepath, mimetype FROM uploaded_documents WHERE id = $1", [documentId]);
        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: "Dokumentas nerastas." });
        }
        const { filepath, mimetype } = fileResult.rows[0];
        const extractedText = await extractTextFromFile(filepath, mimetype);
        if (!extractedText || extractedText.length < 20) {
            return res.status(400).json({ error: "Dokumentas tuščias arba netinkamas analizei." });
        }
        const prompt = `Apibendrink šio dokumento turinį aiškiai ir glaustai:\n\n${extractedText.slice(0, 4000)}`;
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: "Tu esi AI dokumentų analitikas. Glaustai apibendrink dokumento esmę." }, { role: "user", content: prompt },]
        });
        const summary = aiResponse.choices[0].message.content;
        res.status(200).json({ summary });
    } catch (error) {
        console.error("Klaida /analyze:", error.message);
        res.status(500).json({ error: "Įvyko serverio klaida analizuojant dokumentą." });
    }
});


// --- ADMIN PANELĖS MARŠRUTAI ---
app.get('/admin', checkAuth, checkAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, email, created_at, is_approved FROM users WHERE is_admin = FALSE ORDER BY is_approved ASC, created_at DESC");
        const users = result.rows;

        let userListHtml = users.map(user => {
            let actionForm;
            if (user.is_approved) {
                actionForm = `
                    <form action="/admin/unapprove" method="POST" style="display:inline-block;">
                        <input type="hidden" name="userId" value="${user.id}">
                        <button type="submit" class="unapprove-btn" onclick="return confirm('Ar tikrai norite atšaukti šio vartotojo patvirtinimą? Jis nebegalės prisijungti.');">Atšaukti patvirtinimą</button>
                    </form>
                `;
            } else {
                actionForm = `
                    <form action="/admin/approve" method="POST" style="display:inline-block;">
                        <input type="hidden" name="userId" value="${user.id}">
                        <button type="submit" class="approve-btn">Patvirtinti</button>
                    </form>
                `;
            }

            return `
                <tr>
                    <td>${user.id}</td>
                    <td>${user.email}</td>
                    <td>${new Date(user.created_at).toLocaleString('lt-LT')}</td>
                    <td style="font-weight: bold; color: ${user.is_approved ? 'green' : 'red'};">
                        ${user.is_approved ? 'Patvirtintas' : 'Nepatvirtintas'}
                    </td>
                    <td>${actionForm}</td>
                </tr>
            `;
        }).join('');

        res.send(`
            <!DOCTYPE html><html lang="lt"><head><meta charset="UTF-8"><title>Admin Panelė</title>
            <style>body{font-family:sans-serif;padding:20px;background-color:#f8f9fa;color:#333;}h1,h2{color:#343a40;}table{width:100%;border-collapse:collapse;box-shadow:0 2px 5px rgba(0,0,0,0.1);background:white;}th,td{padding:12px 15px;border:1px solid #dee2e6;text-align:left;}th{background-color:#343a40;color:white;}tr:nth-child(even){background-color:#f2f2f2;}button{color:white;border:none;padding:8px 12px;cursor:pointer;border-radius:5px;font-weight:bold;}.approve-btn{background-color:#28a745;}.approve-btn:hover{background-color:#218838;}.unapprove-btn{background-color:#ffc107;color:black;}.unapprove-btn:hover{background-color:#e0a800;}</style>
            </head><body><h1>Administratoriaus Panelė</h1><h2>Vartotojų Valdymas</h2>
            ${users.length > 0 ? `<table><thead><tr><th>ID</th><th>El. Paštas</th><th>Užsiregistravo</th><th>Būsena</th><th>Veiksmas</th></tr></thead><tbody>${userListHtml}</tbody></table>` : '<p>Nėra vartotojų, kuriuos būtų galima valdyti.</p>'}
            </body></html>
        `);
    } catch (error) {
        console.error("Klaida gaunant vartotojų sąrašą:", error);
        res.status(500).send("Klaida gaunant vartotojų sąrašą.");
    }
});

app.post('/admin/approve', checkAuth, checkAdmin, bodyParser.urlencoded({ extended: true }), async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) { return res.status(400).send("Trūksta vartotojo ID."); }
        await pool.query("UPDATE users SET is_approved = TRUE WHERE id = $1", [userId]);
        console.log(`Administratorius patvirtino vartotoją, kurio ID: ${userId}`);
        res.redirect('/admin');
    } catch (error) {
        console.error("Klaida tvirtinant vartotoją:", error);
        res.status(500).send("Klaida tvirtinant vartotoją.");
    }
});

app.post('/admin/unapprove', checkAuth, checkAdmin, bodyParser.urlencoded({ extended: true }), async (req, res) => {
    try {
        const { userId } = req.body;
        if (req.session.userId == userId) { return res.status(400).send("Negalima atšaukti savo paties patvirtinimo."); }
        await pool.query("UPDATE users SET is_approved = FALSE WHERE id = $1", [userId]);
        console.log(`Administratorius atšaukė vartotojo (ID: ${userId}) patvirtinimą.`);
        res.redirect('/admin');
    } catch (error) {
        console.error("Klaida atšaukiant vartotojo patvirtinimą:", error);
        res.status(500).send("Klaida atšaukiant vartotojo patvirtinimą.");
    }
});


//======================================================================
//  4. PAGALBINĖS FUNKCIJOS IR SERVERIO PALEIDIMAS
//======================================================================

const memoryTriggers = [
    "prisimink", "prisiminti", "isimink", "isiminti",
    "issaugok", "issaugoti", "isirasyk", "irasik",
    "atsimink", "uzfiksuok", "turek omenyje", "atmink"
];

function normalize(text) {
    if (!text) return "";
    return text
        .toLowerCase()
        .replace(/ą/g, "a").replace(/č/g, "c").replace(/ę/g, "e")
        .replace(/ė/g, "e").replace(/į/g, "i").replace(/š/g, "s")
        .replace(/ų/g, "u").replace(/ū/g, "u").replace(/ž/g, "z");
}

function isMemoryCommand(message) {
    const cleaned = normalize(message.trim());
    return memoryTriggers.some(trigger =>
        cleaned.startsWith(trigger + " ") || cleaned.startsWith(trigger + ",") || cleaned === trigger
    );
}

function extractMemoryContent(message) {
    const normalizedMessage = normalize(message.trim());
    const foundTrigger = memoryTriggers.find(trigger => normalizedMessage.startsWith(trigger));
    
    if (!foundTrigger) return message;

    const originalWords = message.trim().split(/\s+/);
    const triggerWords = foundTrigger.split(/\s+/);
    
    // Randa pirmo žodžio poziciją po trigerio
    let startIndex = -1;
    for (let i = 0; i <= originalWords.length - triggerWords.length; i++) {
        let match = true;
        for (let j = 0; j < triggerWords.length; j++) {
            if (normalize(originalWords[i+j]) !== triggerWords[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            startIndex = i + triggerWords.length;
            break;
        }
    }
    
    if (startIndex !== -1) {
        return originalWords.slice(startIndex).join(" ").trim();
    }

    return message; // Grąžina originalą, jei kažkas nepavyko
}


async function getUserMemory(user_uuid) {
    if (!user_uuid) return '';
    try {
        const result = await pool.query('SELECT content FROM memories WHERE user_uuid = $1', [user_uuid]);
        if (result.rows.length > 0) {
            return result.rows[0].content;
        } else {
            await pool.query('INSERT INTO memories (user_uuid, content) VALUES ($1, $2)', [user_uuid, '']);
            return '';
        }
    } catch (error) {
        console.error(`Klaida gaunant atmintį vartotojui ${user_uuid}:`, error.message);
        return '';
    }
}

async function updateUserMemory(user_uuid, newInfo) {
    try {
        const existing = await pool.query('SELECT content FROM memories WHERE user_uuid = $1', [user_uuid]);
        let updatedContent = newInfo;
        if (existing.rows.length > 0 && existing.rows[0].content && existing.rows[0].content.trim() !== '') {
            updatedContent = existing.rows[0].content + '\n' + newInfo;
        }
        await pool.query(
            `INSERT INTO memories (user_uuid, content) VALUES ($1, $2)
             ON CONFLICT (user_uuid) DO UPDATE SET content = $2, updated_at = now()`,
            [user_uuid, updatedContent]
        );
    } catch (error) {
        console.error(`Klaida atnaujinant atmintį vartotojui ${user_uuid}:`, error.message);
    }
}


async function deleteConversation(conversationId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const docsToDelete = await client.query('SELECT filepath FROM uploaded_documents WHERE conversation_id = $1', [conversationId]);
        for (const doc of docsToDelete.rows) {
            fs.unlink(doc.filepath, (err) => {
                if (err) { console.error(`Nepavyko ištrinti failo ${doc.filepath}:`, err); }
                else { console.log(`Sėkmingai ištrintas failas: ${doc.filepath}`); }
            });
        }
        await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
        await client.query('COMMIT');
        console.log(`Sėkmingai ištrintas pokalbis ir susiję failai: ${conversationId}`);
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Klaida trinant pokalbį ${conversationId}:`, error.message);
        return { success: false, error: error.message };
    } finally {
        client.release();
    }
}

async function generateAndSaveTitle(conversationId, userMessage, aiMessage) {
    try {
        const userPromptPart = userMessage
            ? `Vartotojas: "${userMessage}"`
            : 'Vartotojas įkėlė dokumentą analizei.';

        const prompt = `Remdamasis šiuo pokalbiu, sugeneruok trumpą, 4-6 žodžių pavadinimą lietuvių kalba. Nenaudok kabučių.\n\n${userPromptPart}\nAsistentas: "${aiMessage.substring(0, 300)}..."\n\nPavadinimas:`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.5,
            max_tokens: 20,
        });

        let newTitle = response.choices[0].message.content.trim().replace(/"/g, '');
        if (newTitle) {
            await pool.query("UPDATE conversations SET title = $1 WHERE id = $2", [newTitle, conversationId]);
            console.log(`Sėkmingai atnaujintas pavadinimas pokalbiui ${conversationId}: ${newTitle}`);
            return newTitle;
        }
    } catch (error) {
        console.error("Klaida generuojant pavadinimą:", error.message);
    }
    return null;
}
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Serveris veikia adresu: http://localhost:${port}`);
});
