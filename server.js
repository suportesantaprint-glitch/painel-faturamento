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
const dataDirectory = configuredDataDirectory
  ? path.isAbsolute(configuredDataDirectory)
    ? configuredDataDirectory
    : path.join(__dirname, configuredDataDirectory)
  : path.join(__dirname, "data");
const databasePath = path.join(dataDirectory, "faturamento.db");
const publicDirectory = path.join(__dirname, "public");

let db;

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
      "/api/contratos/status?year=AAAA&month=0-11",
    ],
  });
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
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

initializeDatabase()
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
