const { app, ensureDatabase } = require("../server");

module.exports = async (request, response) => {
  try {
    await ensureDatabase();
    return app(request, response);
  } catch (error) {
    console.error("Falha ao inicializar a API:", error);
    return response.status(500).json({ mensagem: "Falha ao inicializar a API." });
  }
};
