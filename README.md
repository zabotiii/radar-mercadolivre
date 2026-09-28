# Radar MercadoLivre V2

Configure na Vercel:
- `ML_CLIENT_ID` = `8513847317544949`
- `ML_CLIENT_SECRET` = sua Secret Key do Mercado Livre (não envie para o chat)
- `ML_REDIRECT_URI` = `https://radarafiliadomvp.vercel.app`
- `SESSION_SECRET` = uma senha aleatória longa, exclusiva do projeto

A V2 implementa OAuth 2.0, state, troca do code por token, refresh token, `/users/me` e busca de produtos MLB. O link de afiliado não é inventado nesta versão; será integrado quando o mecanismo oficial específico do programa de afiliados estiver definido.
