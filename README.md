# Radar Baby

Radar de ofertas afiliadas especializado em gestantes, bebês e crianças de todas as idades.

## Fontes de ofertas

- Mercado Livre: busca autenticada via OAuth e API de produtos.
- Shopee: busca via Shopee Affiliate Open API (GraphQL).
- Amazon Brasil: busca via Amazon Creators API.

## Variáveis de ambiente na Vercel

### Mercado Livre
- `ML_CLIENT_ID`
- `ML_CLIENT_SECRET`
- `ML_REDIRECT_URI` — URL de callback cadastrada no aplicativo do Mercado Livre.
- `SESSION_SECRET` — segredo aleatório longo, exclusivo do projeto.

### Shopee
- `SHOPEE_APP_ID`
- `SHOPEE_SECRET`

As credenciais da API de afiliados precisam ser liberadas pela Shopee. A integração utiliza o endpoint oficial `https://open-api.affiliate.shopee.com.br/graphql`.

### Amazon Brasil
- `AMAZON_CLIENT_ID`
- `AMAZON_CLIENT_SECRET`
- `AMAZON_PARTNER_TAG` — tracking ID do Programa de Associados da Amazon.com.br.

A integração usa a Creators API. A Amazon exige participação no Programa de Associados, acesso aprovado à Creators API e atendimento aos critérios de elegibilidade da conta. Não coloque credenciais no GitHub ou no navegador.

### Facebook
- `FB_APP_ID`
- `FB_APP_SECRET`
- `FB_REDIRECT_URI`
- `SESSION_SECRET` — compartilhado com a sessão criptografada do projeto.

A publicação automática na Página do Facebook já foi implementada na versão anterior. Confirme os domínios e URLs de callback do app Meta ao criar o projeto de produção do Radar Baby.

## Categorias do Radar Baby

- Gestante e maternidade
- Fraldas e higiene
- Alimentação
- Passeio e segurança
- Quarto e sono
- Roupas e calçados
- Brinquedos
- Infantil e escolar

## Branches

- `main`: versão anterior do Radar de Ofertas, preservada.
- `radar-baby`: reconstrução especializada do Radar Baby.

## Observações

A presença de um conector no código não garante acesso à API. Cada marketplace depende das credenciais, permissões e aprovação da respectiva conta de afiliado. Valores, descontos, disponibilidade e comissões devem ser tratados como dados retornados pelas lojas, nunca como garantias.
