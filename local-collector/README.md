# Coletor local do Mercado Livre

Este pequeno serviço abre o Google Chrome no seu computador e lê a página que você realmente vê. Ele existe para obter preços e promoções que a API do Mercado Livre não libera para anúncios de outros vendedores.

## Como usar

1. Feche apenas janelas antigas do coletor, se houver.
2. Dê dois cliques em `iniciar-coletor.cmd`.
3. Copie o **Token local** mostrado na janela preta.
4. No painel Promozap, abra **Consultar produtos → Coletor pelo navegador**.
5. Cole o token, depois cole a URL do produto ou um código `MLB...` e clique em **Abrir e extrair dados**.
6. Na primeira execução, entre na sua conta do Mercado Livre na janela do Chrome aberta pelo coletor. Essa sessão fica somente em `local-collector/state/chrome-profile` no seu computador.

O coletor não tenta resolver CAPTCHA nem confirmação de identidade. Se o Mercado Livre pedir uma validação, conclua-a manualmente na janela aberta e tente novamente.

## Entradas aceitas

- URL completa do produto, inclusive páginas `/up/MLBU...`;
- `MLB123456789` ou `MLB-123456789`.

Um código `MLBU...` isolado não contém o slug necessário para reconstruir a URL. Nesse caso, cole a URL completa.

## Dados coletados

Preço anterior, preço normal, preço no Pix, desconto, cupom e preço com cupom, parcelas, título, IDs MLB/MLBU, imagens oficiais, vendedor, loja oficial, vendidos, estoque, entrega, frete, avaliação, descrição, categorias e ficha técnica.

Os valores podem variar conforme conta, CEP, Meli+ e benefícios de primeira compra. O resultado registra esse contexto para evitar tratar um preço personalizado como universal.
