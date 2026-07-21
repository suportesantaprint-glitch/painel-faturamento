const cors = require("cors");
const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const app = express();
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001);
const NODE_ENV = process.env.NODE_ENV || "development";
const configuredDataDirectory = process.env.DATA_DIR;
const isVercelRuntime = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const dataDirectory = configuredDataDirectory
  ? path.isAbsolute(configuredDataDirectory)
    ? configuredDataDirectory
    : path.join(__dirname, configuredDataDirectory)
  : isVercelRuntime
    ? path.join(os.tmpdir(), "controle-faturamento")
  : path.join(__dirname, "data");
const databasePath = path.join(dataDirectory, "faturamento.db");
const publicDirectory = path.join(__dirname, "public");

function loadInitialContracts() {
  const html = fs.readFileSync(path.join(publicDirectory, "index.html"), "utf8");
  const match = html.match(/const CONTRATOS_PADRAO = (\[[\s\S]*?\]);/);

  if (!match) {
    throw new Error("Lista inicial de contratos não encontrada.");
  }

  return JSON.parse(match[1].replace(/,\s*\]/g, "]"));
}

let db;
let databaseInitialization;

function resolveTlsPair() {
  const envCert = process.env.TLS_CERT_FILE;
  const envKey = process.env.TLS_KEY_FILE;
  const allowBundledTls =
    NODE_ENV !== "production" && process.env.ALLOW_LOCAL_TLS !== "false";

  const candidates = [];

  if (envCert && envKey) {
    candidates.push({ cert: envCert, key: envKey });
  }

  if (allowBundledTls) {
    candidates.push(
      { cert: "lan-cert.pem", key: "lan-key.pem" },
      { cert: "localhost+1.pem", key: "localhost+1-key.pem" },
      { cert: "localhost+2.pem", key: "localhost+2-key.pem" }
    );
  }

  for (const candidate of candidates) {
    const certPath = path.isAbsolute(candidate.cert)
      ? candidate.cert
      : path.join(__dirname, candidate.cert);
    const keyPath = path.isAbsolute(candidate.key)
      ? candidate.key
      : path.join(__dirname, candidate.key);

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return { certPath, keyPath };
    }
  }

  return null;
}

function getLocalIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    });
  });

  return addresses;
}

async function initializeDatabase() {
  fs.mkdirSync(dataDirectory, { recursive: true });

  db = await open({
    filename: databasePath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS faturamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL CHECK (valor >= 0),
      data TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS contratos_status (
      ano INTEGER NOT NULL,
      mes INTEGER NOT NULL CHECK (mes >= 0 AND mes <= 11),
      contrato_key TEXT NOT NULL,
      faturado INTEGER NOT NULL CHECK (faturado IN (0, 1)),
      data_marcacao TEXT,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ano, mes, contrato_key)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS contratos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT NOT NULL UNIQUE,
      numero TEXT NOT NULL,
      cliente TEXT NOT NULL,
      contato TEXT NOT NULL DEFAULT '',
      dia_coleta INTEGER NOT NULL CHECK (dia_coleta >= 1 AND dia_coleta <= 31),
      vencimento TEXT NOT NULL DEFAULT '',
      processo TEXT NOT NULL DEFAULT '',
      franquia TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
  `);

  const contractsSeeded = await db.get(
    "SELECT valor FROM app_config WHERE chave = 'contratos_iniciais_importados'"
  );
  if (!contractsSeeded) {
    const existingContracts = await db.get("SELECT COUNT(*) AS total FROM contratos");
    if (existingContracts.total === 0) {
      const contratosIniciais = loadInitialContracts();
      for (const [numero, cliente, contato, diaColeta, vencimento, processo, franquia] of contratosIniciais) {
        await db.run(
          `
          INSERT INTO contratos (chave, numero, cliente, contato, dia_coleta, vencimento, processo, franquia)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [`${numero}_${cliente}`, String(numero), cliente, contato, diaColeta, vencimento, processo, franquia]
        );
      }
    }
    await db.run(
      "INSERT INTO app_config (chave, valor) VALUES ('contratos_iniciais_importados', 'true')"
    );
  }
}

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 3000) {
    return null;
  }
  return year;
}

function parseMonth(value) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 0 || month > 11) {
    return null;
  }
  return month;
}

function parseCollectionDay(value) {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return null;
  }
  return day;
}

function parseContractText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function contractResponse(row) {
  return {
    id: row.id,
    chave: row.chave,
    numero: row.numero,
    cliente: row.cliente,
    contato: row.contato,
    diaColeta: row.dia_coleta,
    vencimento: row.vencimento,
    processo: row.processo,
    franquia: row.franquia,
  };
}

app.use(cors());
app.use(express.json());
app.use(express.static(publicDirectory));

app.get("/", (_request, response) => {
  response.sendFile(path.join(publicDirectory, "index.html"));
});

app.get("/api", (_request, response) => {
  response.json({
    ok: true,
    mensagem: "API de faturamento ativa.",
    endpoints: [
      "/api/health",
      "/api/faturamentos",
      "/api/contratos",
      "/api/contratos/status?year=AAAA&month=0-11",
    ],
  });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/contratos", async (_request, response) => {
  try {
    const rows = await db.all(`
      SELECT id, chave, numero, cliente, contato, dia_coleta, vencimento, processo, franquia
      FROM contratos
      ORDER BY dia_coleta, CAST(numero AS INTEGER), id
    `);
    response.json(rows.map(contractResponse));
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao carregar contratos." });
  }
});

app.post("/api/contratos", async (request, response) => {
  const numero = parseContractText(request.body.numero, 80);
  const cliente = parseContractText(request.body.cliente);
  const contato = parseContractText(request.body.contato);
  const diaColeta = parseCollectionDay(request.body.diaColeta);
  const vencimento = parseContractText(request.body.vencimento);
  const processo = parseContractText(request.body.processo);
  const franquia = parseContractText(request.body.franquia, 80);

  if (!numero || !cliente || diaColeta === null) {
    response.status(400).json({ mensagem: "Informe número, cliente e um dia de coleta entre 1 e 31." });
    return;
  }

  try {
    const temporaryKey = `novo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const result = await db.run(
      `
      INSERT INTO contratos (chave, numero, cliente, contato, dia_coleta, vencimento, processo, franquia)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [temporaryKey, numero, cliente, contato, diaColeta, vencimento, processo, franquia]
    );
    const key = `contrato_${result.lastID}`;
    await db.run(
      "UPDATE contratos SET chave = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
      [key, result.lastID]
    );
    const row = await db.get(
      "SELECT id, chave, numero, cliente, contato, dia_coleta, vencimento, processo, franquia FROM contratos WHERE id = ?",
      [result.lastID]
    );
    response.status(201).json(contractResponse(row));
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao incluir contrato." });
  }
});

app.patch("/api/contratos/:id", async (request, response) => {
  const id = Number(request.params.id);
  const diaColeta = parseCollectionDay(request.body.diaColeta);

  if (!Number.isInteger(id) || id <= 0 || diaColeta === null) {
    response.status(400).json({ mensagem: "Dia de coleta inválido." });
    return;
  }

  try {
    const result = await db.run(
      "UPDATE contratos SET dia_coleta = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
      [diaColeta, id]
    );
    if (result.changes === 0) {
      response.status(404).json({ mensagem: "Contrato não encontrado." });
      return;
    }
    const row = await db.get(
      "SELECT id, chave, numero, cliente, contato, dia_coleta, vencimento, processo, franquia FROM contratos WHERE id = ?",
      [id]
    );
    response.json(contractResponse(row));
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao atualizar a coleta." });
  }
});

app.delete("/api/contratos/:id", async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ mensagem: "Contrato inválido." });
    return;
  }

  try {
    const contract = await db.get("SELECT chave FROM contratos WHERE id = ?", [id]);
    if (!contract) {
      response.status(404).json({ mensagem: "Contrato não encontrado." });
      return;
    }
    await db.run("DELETE FROM contratos_status WHERE contrato_key = ?", [contract.chave]);
    await db.run("DELETE FROM contratos WHERE id = ?", [id]);
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao excluir contrato." });
  }
});

app.get("/api/contratos/status", async (request, response) => {
  const year = parseYear(request.query.year);
  const month = parseMonth(request.query.month);

  if (year === null || month === null) {
    response.status(400).json({ mensagem: "Ano ou mes invalido." });
    return;
  }

  try {
    const rows = await db.all(
      `
      SELECT
        contrato_key AS contratoKey,
        faturado,
        data_marcacao AS dataMarcacao
      FROM contratos_status
      WHERE ano = ? AND mes = ?
      `,
      [year, month]
    );

    const state = {};
    rows.forEach((row) => {
      state[row.contratoKey] = {
        faturado: Boolean(row.faturado),
        data: row.dataMarcacao || null,
      };
    });

    response.json({ ano: year, mes: month, state });
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao carregar status dos contratos." });
  }
});

app.put("/api/contratos/status", async (request, response) => {
  const year = parseYear(request.body.year);
  const month = parseMonth(request.body.month);
  const contratoKey = String(request.body.contratoKey || "").trim();
  const faturado = request.body.faturado === true;
  const dataMarcacao = String(request.body.data || "").trim() || null;

  if (year === null || month === null || !contratoKey) {
    response.status(400).json({ mensagem: "Dados invalidos para salvar status." });
    return;
  }

  try {
    if (faturado) {
      await db.run(
        `
        INSERT INTO contratos_status (ano, mes, contrato_key, faturado, data_marcacao)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT (ano, mes, contrato_key) DO UPDATE SET
          faturado = 1,
          data_marcacao = excluded.data_marcacao,
          atualizado_em = CURRENT_TIMESTAMP
        `,
        [year, month, contratoKey, dataMarcacao]
      );
    } else {
      await db.run(
        `
        DELETE FROM contratos_status
        WHERE ano = ? AND mes = ? AND contrato_key = ?
        `,
        [year, month, contratoKey]
      );
    }

    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao salvar status do contrato." });
  }
});

app.delete("/api/contratos/status", async (request, response) => {
  const year = parseYear(request.query.year);
  const month = parseMonth(request.query.month);

  if (year === null || month === null) {
    response.status(400).json({ mensagem: "Ano ou mes invalido." });
    return;
  }

  try {
    await db.run(
      `
      DELETE FROM contratos_status
      WHERE ano = ? AND mes = ?
      `,
      [year, month]
    );

    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao resetar status do mes." });
  }
});

app.get("/api/faturamentos", async (_request, response) => {
  try {
    const rows = await db.all(
      `
      SELECT
        id,
        descricao,
        valor,
        data,
        criado_em AS criadoEm
      FROM faturamentos
      ORDER BY data DESC, id DESC
      `
    );

    response.json(rows);
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao buscar faturamentos." });
  }
});

app.post("/api/faturamentos", async (request, response) => {
  const descricao = String(request.body.descricao || "").trim();
  const valor = Number(request.body.valor);
  const data = String(request.body.data || "").trim();

  if (!descricao) {
    response.status(400).json({ mensagem: "Descricao e obrigatoria." });
    return;
  }

  if (!Number.isFinite(valor) || valor < 0) {
    response.status(400).json({ mensagem: "Valor invalido." });
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    response.status(400).json({ mensagem: "Data invalida. Use AAAA-MM-DD." });
    return;
  }

  try {
    const result = await db.run(
      `
      INSERT INTO faturamentos (descricao, valor, data)
      VALUES (?, ?, ?)
      `,
      [descricao, valor, data]
    );

    const novoItem = await db.get(
      `
      SELECT
        id,
        descricao,
        valor,
        data,
        criado_em AS criadoEm
      FROM faturamentos
      WHERE id = ?
      `,
      [result.lastID]
    );

    response.status(201).json(novoItem);
  } catch (error) {
    response.status(500).json({ mensagem: "Erro ao salvar faturamento." });
  }
});

function ensureDatabase() {
  if (!databaseInitialization) {
    databaseInitialization = initializeDatabase().catch((error) => {
      databaseInitialization = undefined;
      throw error;
    });
  }
  return databaseInitialization;
}

function startServer() {
  ensureDatabase()
  .then(() => {
    const tlsPair = resolveTlsPair();
    const server = tlsPair
      ? https.createServer(
          {
            cert: fs.readFileSync(tlsPair.certPath),
            key: fs.readFileSync(tlsPair.keyPath),
          },
          app
        )
      : http.createServer(app);
    const protocol = tlsPair ? "https" : "http";

    server.listen(PORT, HOST, () => {
      const ips = getLocalIpv4Addresses();
      console.log(`Servidor iniciado em ${protocol}://${HOST}:${PORT}`);
      ips.forEach((ip) => {
        console.log(`Acesso na rede: ${protocol}://${ip}:${PORT}`);
      });
      console.log(`Banco SQLite em: ${databasePath}`);
      if (tlsPair) {
        console.log(`Certificado TLS: ${tlsPair.certPath}`);
        console.log(`Chave TLS: ${tlsPair.keyPath}`);
      } else {
        console.log(
          "TLS nao habilitado (nenhum par de certificado encontrado). Use TLS_CERT_FILE e TLS_KEY_FILE para configurar."
        );
      }
    });
  })
  .catch((error) => {
    console.error("Falha ao iniciar banco SQLite:", error);
    process.exit(1);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  ensureDatabase,
};
