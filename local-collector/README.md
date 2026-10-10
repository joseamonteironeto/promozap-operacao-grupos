# Coletor local do Mercado Livre

Este pequeno serviço abre o Google Chrome no seu computador e lê a página que você realmente vê. Ele existe para obter preços e promoções que a API do Mercado Livre não libera para anúncios de outros vendedores.

## Como usar

1. Feche apenas janelas antigas do coletor, se houver.
2. Dê dois cliques em `iniciar-coletor.cmd`.
3. O painel local será aberto automaticamente no seu navegador.
4. Cole a URL ou um código `MLB...` e clique em **Abrir Chrome e extrair dados**.
5. Para pesquisar várias ofertas, escolha quantos anúncios deseja **analisar** (até 10.000) e quantos deseja **mostrar** no catálogo (até 500). Essa separação evita tentar renderizar milhares de cartões de uma vez.
6. Para começar por smartphones, clique em **Aplicar preset Celulares**. Ele seleciona a categoria, ativa a validação de ofertas e prepara uma varredura de até 10.000 anúncios.
7. Clique em **Ativar monitor de novidades** para repetir a consulta enquanto o coletor estiver aberto.
8. Se preferir a integração direta do painel online, copie o **Token local** mostrado na janela preta.
9. Na primeira execução, entre na sua conta do Mercado Livre na janela do Chrome aberta pelo coletor. Essa sessão fica somente em `local-collector/state/chrome-profile` no seu computador.

O coletor não tenta resolver CAPTCHA nem confirmação de identidade. Se o Mercado Livre pedir uma validação, conclua-a manualmente na janela aberta e tente novamente.

O painel local não precisa do token manualmente e é o modo mais confiável. A conexão direta a partir do painel online pode ser bloqueada por políticas de rede local do navegador.

## Entradas aceitas

- URL completa do produto, inclusive páginas `/up/MLBU...`;
- `MLB123456789` ou `MLB-123456789`.

Um código `MLBU...` isolado não contém o slug necessário para reconstruir a URL. Nesse caso, cole a URL completa.

## Dados coletados

Preço anterior, preço normal, preço no Pix, desconto, cupom, benefício, compra mínima, código (quando visível), preço com cupom, parcelas, título, IDs MLB/MLBU, imagens oficiais, vendedor, loja oficial, vendidos, estoque, entrega, frete, avaliação, descrição, categorias e ficha técnica. O detalhe também reúne até 10 avaliações públicas e associa a cada uma as fotos publicadas pelo comprador.

Cada consulta individual salva uma medição em `state/price-history.json`. O detalhe mostra o preço atual, o menor e o maior valor observados e um gráfico real da evolução. O preço anterior exibido pelo Mercado Livre aparece separadamente como referência; ele não é tratado como uma medição histórica.

No catálogo, os produtos são ordenados por uma pontuação que combina desconto calculado sobre o preço anterior, cupom, oferta do dia, frete grátis, loja oficial, avaliação e volume de vendas. O filtro de categoria é aplicado na própria página do Mercado Livre, como faria uma pessoa no navegador.

Com **Só ofertas validadas**, o preço riscado não basta. O coletor cruza o preço efetivo com o histórico salvo e sinais independentes de confiança. Enquanto ainda não existem medições suficientes, uma oferta recebe confiança média somente quando reúne desconto forte, outro sinal comercial (oferta do dia ou cupom) e pelo menos um sinal de confiança (loja oficial, boa avaliação, frete grátis ou alto volume vendido). Depois de formar histórico, preços abaixo da mediana observada ganham mais peso. Em celulares, acessórios como capas, cabos e películas são removidos pelo preset.

O teto de 10.000 significa **até** 10.000 anúncios: o Mercado Livre pode encerrar a paginação antes, repetir resultados ou solicitar CAPTCHA. Varreduras grandes levam mais tempo; use 500 para exploração e 10.000 para uma coleta ampla ou monitoramento agendado.

Os valores podem variar conforme conta, CEP, Meli+ e benefícios de primeira compra. O resultado registra esse contexto para evitar tratar um preço personalizado como universal.
