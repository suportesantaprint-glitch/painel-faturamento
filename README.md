# Controle de Faturamento com SQLite

Aplicacao web com frontend estatico em `public/`, backend Express em `server.js` e persistencia local em SQLite.

## Rodar localmente

1. Instale as dependencias:
   ```bash
   npm install
   ```
2. Suba o servidor:
   ```bash
   npm run server
   ```

A aplicacao fica disponivel na URL exibida no terminal.
Se os certificados locais `.pem` estiverem presentes, ela sobe em `https://localhost:3001`.
Caso contrario, usa `http://localhost:3001`.

## Banco de dados

Por padrao, o SQLite fica em:

`data/faturamento.db`

Em producao, voce pode definir outro diretorio com a variavel:

```bash
DATA_DIR=/caminho/do/banco
```

O arquivo final sera criado como:

`<DATA_DIR>/faturamento.db`

## Deploy 24/7 no Google Cloud

Para este projeto, o caminho recomendado e `Compute Engine` e nao `Cloud Run` nem `App Engine`, porque o banco usa SQLite local.

### Por que VM e a melhor opcao aqui

- `Cloud Run` usa filesystem descartavel e nao persiste o SQLite local.
- `App Engine Standard` tambem nao oferece disco persistente para esse uso.
- `Compute Engine e2-micro` permite deixar a app ligada 24/7 com disco persistente.

### Regioes para ficar no Always Free

Use uma zona dentro de uma destas regioes dos EUA:

- `us-east1`
- `us-central1`
- `us-west1`

### Deploy automatico com gcloud no Windows

No PowerShell, dentro desta pasta:

```powershell
.\deploy-google-cloud.ps1 -ProjectId SEU_PROJETO
```

O script:

- cria uma VM `e2-micro` Debian 12
- abre HTTP na porta 80
- envia o projeto sem `node_modules`, `data` e certificados locais
- instala Node.js, Nginx e dependencias
- configura a app como servico `systemd`
- guarda o SQLite em `/var/lib/controle-faturamento`

Ao final, ele mostra a URL publica da VM.

### Comandos uteis depois do deploy

Ver logs:

```powershell
gcloud compute ssh controle-faturamento-vm --zone us-east1-b --command "sudo journalctl -u controle-faturamento -n 100 --no-pager"
```

Reaplicar deploy:

```powershell
.\deploy-google-cloud.ps1 -ProjectId SEU_PROJETO
```

Parar e iniciar o servico manualmente na VM:

```bash
sudo systemctl restart controle-faturamento
sudo systemctl status controle-faturamento
```

## Endpoints principais

- `GET /api`
- `GET /api/health`
- `GET /api/faturamentos`
- `POST /api/faturamentos`
- `GET /api/contratos/status?year=2026&month=4`
- `PUT /api/contratos/status`
- `DELETE /api/contratos/status?year=2026&month=4`

### Exemplo de `POST /api/faturamentos`

```json
{
  "descricao": "Servico mensal",
  "valor": 2500.5,
  "data": "2026-05-28"
}
```

### Exemplo de `PUT /api/contratos/status`

```json
{
  "year": 2026,
  "month": 4,
  "contratoKey": "123_CLIENTE",
  "faturado": true,
  "data": "28/05/2026"
}
```
