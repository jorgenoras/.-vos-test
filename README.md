> Atualização v2: consultar ATUALIZACAO_V2.txt para comportamento atual, validação e publicação. O texto abaixo documenta a versão original.

# Ponte Voz — versão inicial v1 (6 de novembro de 2026)

Aplicação web pessoal, compatível com iPhone 13 através do Safari, de tradução **português de Portugal ↔ ucraniano**. Nesta versão há tradução de texto e voz em intervenções curtas (gravar → parar → aguardar). A língua de origem é detetada automaticamente e a tradução é apresentada para copiar para o WhatsApp ou ouvir com uma voz disponível no iPhone.

## O que funciona / o que ainda não existe

- **Implementado no código:** acesso por código secreto; texto e tradução bidirecional; captura da voz até 30 segundos e transcrição; leitura da tradução pela voz do dispositivo; copiar para o WhatsApp; não guardar histórico na aplicação; interface para adicionar ao ecrã principal do iPhone.
- **Ainda não implementado:** tradução simultânea contínua; tradução dentro das chamadas do WhatsApp; acesso direto e automático às mensagens ou aos áudios do WhatsApp; voz masculina ucraniana garantida; operação offline; integração nativa no iOS.
- **Ainda não validado com uma conta real:** acesso aos modelos e respostas de tradução/transcrição da API OpenAI; gravação no Safari do iPhone; instalação no Render. Estes testes exigem credenciais e dispositivos a que o criador deste pacote não tem acesso.

## 1 — Passo imediato no computador: carregar o código no GitHub privado

1. Descarrega `Ponte_Voz_V1.zip` e **extrai-o** (botão direito → «Extrair tudo»). Abre a pasta `ponte-voz-v1` que foi extraída.
2. Volta ao repositório privado `ponte-voz` no GitHub, onde já foi criada a página «Quick setup».
3. Nessa página, clica em **«uploading an existing file»**. Em alternativa: «Add file» → «Upload files».
4. Seleciona todos os ficheiros **dentro** da pasta extraída (não o ZIP e não a pasta exterior); arrasta-os para a zona «Drag files here». Confirma que aparecem, entre outros, `app.py`, `index.html`, `requirements.txt`, `app.js`, `styles.css` e `render.yaml`.
5. Carrega em **«Commit changes»**. O código fica no repositório privado. Os ficheiros do ZIP não contêm credenciais reais.

Se o navegador não aceitar arrastar todos os ficheiros de uma vez, seleciona-os com Ctrl+A na pasta e arrasta para o GitHub. Não coloques nunca uma chave API ou um código pessoal em ficheiros de código.

## 2 — No Render: criar um Web Service

1. No painel do Render, escolhe «New» → **«Web Service»** (não «Static Site»). Liga o GitHub pelo «Git Provider» e seleciona o repositório privado `ponte-voz`.
2. Para este projeto usa: **Language = Python 3**, **Build Command = `pip install -r requirements.txt`**, **Start Command = `uvicorn app:app --host 0.0.0.0 --port $PORT`**. Escolhe o plano de alojamento de acordo com o preço que o Render mostrar; não é garantido que permaneça gratuito.
3. Em **Environment**, adiciona estas duas variáveis secretas: `APP_ACCESS_CODE` (um código forte criado por ti, com pelo menos 12 caracteres, idealmente 20+) e `OPENAI_API_KEY` (chave da OpenAI Platform, **diferente** da palavra-passe da tua conta ChatGPT/Google). **Não partilhes nenhuma delas na conversa.** Se pretenderes, define também `FORCE_HTTPS=1`.
4. Cria o serviço e verifica o estado do deploy. Sem as variáveis configuradas, o serviço não arranca ou não traduz. O repositório privado **não basta para tornar o URL privado**: o código de acesso protege as funcionalidades da app, mas a página de início de sessão continua alcançável na internet. Para isolamento de rede completo seria necessária uma arquitetura diferente (por exemplo, VPN).

**Nota:** O plano gratuito do Render pode adormecer após 15 minutos de inatividade e demorar cerca de um minuto a acordar; não é indicado para tradução sempre imediata. Ter ChatGPT não significa necessariamente ter saldo/crédito na API. As chamadas à API da OpenAI podem ter custos de utilização; a hospedagem no Render também pode ter custos.

## 3 — No iPhone

1. Quando o serviço Render estiver funcional, abre o **URL HTTPS** do Render no Safari do iPhone (não confundir com o URL do GitHub).
2. Escreve o código de acesso privado que definiste no Render.
3. Experimenta «Texto»: escreve `Bom dia, como estás?` e toca «Traduzir mensagem». Deve aparecer ucraniano. Depois experimenta a direção inversa.
4. Em «Voz», toca em «Gravar voz». O Safari pode pedir permissão para o microfone; aceita apenas durante a utilização. Diz uma frase curta, toca «Parar gravação» e aguarda a tradução. A app desliga as pistas do microfone ao parar. A gravação não é enviada até parares a gravação.
5. Para ter um ícone, no Safari usa **Partilhar → Adicionar ao ecrã principal**. O atalho abre a web app; para traduzir continua a ser necessária internet.
6. Para enviar uma tradução por WhatsApp, toca «Copiar para WhatsApp», abre a conversa pretendida no WhatsApp e cola o texto manualmente.

## Privacidade / segurança

- O servidor **não grava** as frases ou ficheiros áudio em ficheiros ou base de dados e não cria um histórico. O ecrã guarda apenas o resultado atual em memória até apagar ou sair.
- A aplicação faz chamadas de tradução/transcrição à **OpenAI API**. Para as respostas de texto, `store=false` é enviado. A OpenAI pode manter registos de segurança, habitualmente até 30 dias, dependendo das condições da API; o alojamento Render pode ter logs técnicos. **Isto não equivale a retenção zero universal.** Verifica a política aplicável antes de usar informação confidencial.
- A chave de API fica **só no ambiente do servidor Render** (não vai no código JavaScript ou repositório). A página de login usa cookies de sessão com HttpOnly/SameSite e HTTPS no Render.
- O código inclui limites simples para tentativas de login e chamadas de tradução, em memória. É um **protótipo**, não uma solução de segurança auditada para dados altamente sensíveis.
- A voz sintetizada para «Ouvir tradução» usa o `speechSynthesis` do navegador; a qualidade e a disponibilidade de uma voz ucraniana dependem do dispositivo.

## Configuração e teste local para programadores (opcional)

Requer Python 3.11+ e uma chave API para os testes reais:

```bash
python -m venv .venv
# ativar ambiente consoante o sistema operativo
pip install -r requirements.txt
# configurar APP_ACCESS_CODE e OPENAI_API_KEY no ambiente
python app.py
```

Abrir `http://127.0.0.1:5000` no computador. **No iPhone, a API de microfone requer contexto seguro (HTTPS).** Testes automáticos locais com respostas simuladas (não validam o serviço real de IA nem o iPhone): `PONTE_VOZ_TESTING=1 python -m unittest discover -p 'test_*.py'`.

## Referências técnicas verificadas em 2026-11-06

- Render/deploy de aplicações web: https://render.com/docs/your-first-deploy
- Render/plano gratuito e limitações: https://render.com/docs/free
- Render/Variáveis secretas: https://render.com/docs/configure-environment-variables
- OpenAI/Transcrição: https://developers.openai.com/api/docs/guides/speech-to-text
- OpenAI/Modelos: https://developers.openai.com/api/docs/models
- OpenAI/Retenção: https://developers.openai.com/api/docs/guides/your-data
