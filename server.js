const cors = require("cors");
const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001);
const NODE_ENV = process.env.NODE_ENV || "development";
const publicDirectory = path.join(__dirname, "public");

// ==========================================
// Configuração do Supabase Client
// ==========================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;

// No Node.js (backend), dê preferência à SUPABASE_SERVICE_ROLE_KEY se disponível.
// Se não, usa a chave de publicação (Anon Key).
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY ||
  process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERRO: Variáveis de ambiente do Supabase não encontradas! Verifique o seu .env");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// Funções Auxiliares
// ==========================================

function loadInitialContracts() {
  const html = fs.readFileSync(path.join(publicDirectory, "index.html"), "utf8");
  const match = html.match(/const CONTRATOS_PADRAO = (\[[\s\S]*?\]);/);

  if (!match) {
    throw new Error("Lista inicial de contratos não encontrada.");
  }

  return JSON.parse(match[1].replace(/,\s*\]/g, "]"));
}

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

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 3000) return null;
  return year;
}

function parseMonth(value) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  return month;
}

function parseCollectionDay(value) {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
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

// ==========================================
// Inicialização do Banco (Supabase)
// ==========================================

async function initializeDatabase() {
  const { data: contractsSeeded } = await supabase
    .from("app_config")
    .select("valor")
    .eq("chave", "contratos_iniciais_importados")
    .maybeSingle();

  if (!contractsSeeded) {
    const { count } = await supabase
      .from("contratos")
      .select("*", { count: "exact", head: true });

    if (count === 0) {
      const contratosIniciais = loadInitialContracts();
      const payload = contratosIniciais.map(
        ([numero, cliente, contato, diaColeta, vencimento, processo, franquia]) => ({
          chave: `${numero}_${cliente}`,
          numero: String(numero),
          cliente,
          contato,
          dia_coleta: diaColeta,
          vencimento,
          processo,
          franquia,
        })
      );

      if (payload.length > 0) {
        const { error: insertError } = await supabase.from("contratos").insert(payload);
        if (insertError) throw insertError;
      }
    }

    await supabase
      .from("app_config")
      .upsert({ chave: "contratos_iniciais_importados", valor: "true" });
  }
}

// ==========================================
// Configuração do Express
// ==========================================

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

// ==========================================
// Rotas de Contratos
// ==========================================

app.get("/api/contratos", async (_request, response) => {
  try {
    const { data: rows, error } = await supabase
      .from("contratos")
      .select("id, chave, numero, cliente, contato, dia_coleta, vencimento, processo, franquia")
      .order("dia_coleta", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw error;

    rows.sort((a, b) => {
      if (a.dia_coleta !== b.dia_coleta) return a.dia_coleta - b.dia_coleta;
      const numA = parseInt(a.numero, 10) || 0;
      const numB = parseInt(b.numero, 10) || 0;
      if (numA !== numB) return numA - numB;
      return a.id - b.id;
    });

    response.json(rows.map(contractResponse));
  } catch (error) {
    console.error(error);
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

    const { data: created, error: insertError } = await supabase
      .from("contratos")
      .insert({
        chave: temporaryKey,
        numero,
        cliente,
        contato,
        dia_coleta: diaColeta,
        vencimento,
        processo,
        franquia,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const finalKey = `contrato_${created.id}`;
    const { data: updated, error: updateError } = await supabase
      .from("contratos")
      .update({ chave: finalKey, atualizado_em: new Date().toISOString() })
      .eq("id", created.id)
      .select()
      .single();

    if (updateError) throw updateError;

    response.status(201).json(contractResponse(updated));
  } catch (error) {
    console.error(error);
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
    const { data, error } = await supabase
      .from("contratos")
      .update({ dia_coleta: diaColeta, atualizado_em: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      response.status(404).json({ mensagem: "Contrato não encontrado." });
      return;
    }

    response.json(contractResponse(data));
  } catch (error) {
    console.error(error);
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
    const { data: contract, error: findError } = await supabase
      .from("contratos")
      .select("chave")
      .eq("id", id)
      .maybeSingle();

    if (findError) throw findError;
    if (!contract) {
      response.status(404).json({ mensagem: "Contrato não encontrado." });
      return;
    }

    await supabase.from("contratos_status").delete().eq("contrato_key", contract.chave);
    await supabase.from("contratos").delete().eq("id", id);

    response.json({ ok: true });
  } catch (error) {
    console.error(error);
    response.status(500).json({ mensagem: "Erro ao excluir contrato." });
  }
});

// ==========================================
// Rotas de Status dos Contratos
// ==========================================

app.get("/api/contratos/status", async (request, response) => {
  const year = parseYear(request.query.year);
  const month = parseMonth(request.query.month);

  if (year === null || month === null) {
    response.status(400).json({ mensagem: "Ano ou mes invalido." });
    return;
  }

  try {
    const { data: rows, error } = await supabase
      .from("contratos_status")
      .select("contrato_key, faturado, data_marcacao")
      .eq("ano", year)
      .eq("mes", month);

    if (error) throw error;

    const state = {};
    (rows || []).forEach((row) => {
      state[row.contrato_key] = {
        faturado: Boolean(row.faturado),
        data: row.data_marcacao || null,
      };
    });

    response.json({ ano: year, mes: month, state });
  } catch (error) {
    console.error(error);
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
      const { error } = await supabase.from("contratos_status").upsert(
        {
          ano: year,
          mes: month,
          contrato_key: contratoKey,
          faturado: 1,
          data_marcacao: dataMarcacao,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: "ano,mes,contrato_key" }
      );
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("contratos_status")
        .delete()
        .eq("ano", year)
        .eq("mes", month)
        .eq("contrato_key", contratoKey);
      if (error) throw error;
    }

    response.json({ ok: true });
  } catch (error) {
    console.error(error);
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
    const { error } = await supabase
      .from("contratos_status")
      .delete()
      .eq("ano", year)
      .eq("mes", month);

    if (error) throw error;

    response.json({ ok: true });
  } catch (error) {
    console.error(error);
    response.status(500).json({ mensagem: "Erro ao resetar status do mes." });
  }
});

// ==========================================
// Rotas de Faturamentos
// ==========================================

app.get("/api/faturamentos", async (_request, response) => {
  try {
    const { data: rows, error } = await supabase
      .from("faturamentos")
      .select("id, descricao, valor, data, criado_em")
      .order("data", { ascending: false })
      .order("id", { ascending: false });

    if (error) throw error;

    const formattedRows = rows.map((row) => ({
      id: row.id,
      descricao: row.descricao,
      valor: row.valor,
      data: row.data,
      criadoEm: row.criado_em,
    }));

    response.json(formattedRows);
  } catch (error) {
    console.error(error);
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
    const { data: novoItem, error } = await supabase
      .from("faturamentos")
      .insert({ descricao, valor, data })
      .select("id, descricao, valor, data, criado_em")
      .single();

    if (error) throw error;

    response.status(201).json({
      id: novoItem.id,
      descricao: novoItem.descricao,
      valor: novoItem.valor,
      data: novoItem.data,
      criadoEm: novoItem.criado_em,
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({ mensagem: "Erro ao salvar faturamento." });
  }
});

// ==========================================
// Inicialização do Servidor
// ==========================================

let databaseInitialization;
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
        console.log("Conectado ao Supabase com sucesso.");
      });
    })
    .catch((error) => {
      console.error("Falha ao inicializar a conexão com o Supabase:", error);
      process.exit(1);
    });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
