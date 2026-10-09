# Promozap — Operação de Grupos

Painel mobile-first para monitorar grupos de ofertas no WhatsApp, identificar produtos da Amazon e do Mercado Livre, converter links de afiliado e encaminhar as mensagens pela UAZAPI.

## Recursos

- configuração de grupos de origem e destino por categoria;
- monitoramento por webhook da UAZAPI;
- histórico das ofertas encontradas, convertidas e enviadas;
- geração de links de afiliado Amazon por ASIN;
- geração de links do Mercado Livre usando uma sessão autorizada pelo próprio operador;
- renovação oportunista dos cookies do Mercado Livre quando a resposta oficial envia `Set-Cookie`;
- extração de imagem e dados de produto;
- coletor local opcional que abre o Chrome e lê preço, Pix, cupom, estoque e ficha técnica diretamente da página do Mercado Livre;
- interface responsiva com temas claro e escuro.

## Segurança

Nenhum token, cookie ou credencial deve ser incluído no código ou no histórico Git.

- arquivos `.env*` são ignorados;
- segredos das integrações são armazenados no banco criptografados com AES-GCM;
- `PROMOZAP_WEBHOOK_SECRET` deve ser um segredo longo e aleatório do ambiente de produção;
- `UAZAPI_INSTANCE_TOKEN` deve existir somente no ambiente de execução;
- cookies do Mercado Livre são dados de sessão pessoais: use apenas a sua própria conta e nunca publique o JSON exportado.

A renovação automática não burla o prazo da sessão. O painel apenas armazena novos cookies quando o próprio Mercado Livre os envia durante uma conversão válida. Logout, revogação, autenticação adicional ou expiração definitiva exigem uma nova exportação manual.

## Desenvolvimento local

Requisitos: Node.js 22.13 ou mais recente e pnpm.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

O painel utiliza Cloudflare D1. As migrações estão em `drizzle/` e as ligações do Sites ficam em `.openai/hosting.json`.

### Coletor local do Mercado Livre

Quando a API não autoriza a consulta de anúncios de terceiros, execute `local-collector/iniciar-coletor.cmd` e use a seção **Consultar produtos → Coletor pelo navegador**. Consulte `local-collector/README.md` para o passo a passo. A sessão dedicada do Chrome e o token local ficam ignorados pelo Git.

## Variáveis de ambiente

Crie um arquivo local `.env` sem adicioná-lo ao Git:

```text
PROMOZAP_WEBHOOK_SECRET=troque-por-um-segredo-longo
UAZAPI_INSTANCE_TOKEN=seu-token-da-instancia
UAZAPI_SERVER_URL=https://seu-servidor-uazapi.example
```

Credenciais opcionais de catálogo são cadastradas pelo painel e guardadas de forma criptografada.

## Observações de integração

O projeto usa endpoints e sessões pertencentes às contas configuradas pelo operador. Mudanças nas APIs, políticas ou mecanismos de autenticação de terceiros podem exigir ajustes. Respeite os termos da Amazon, do Mercado Livre, do WhatsApp e da UAZAPI.

## Licença

MIT. Consulte [LICENSE](LICENSE).
