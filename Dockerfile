FROM node:18-slim

WORKDIR /app

# Copia arquivos de dependência
COPY package*.json ./

# Instala dependências de produção
RUN npm install --production

# Copia o resto do código da aplicação
COPY . .

# Expõe a porta que o Express escuta (3001 por padrão)
EXPOSE 3001

# Variáveis de ambiente padrão
ENV PORT=3001
ENV HOST=0.0.0.0

# Comando para iniciar o servidor
CMD ["node", "server.js"]
