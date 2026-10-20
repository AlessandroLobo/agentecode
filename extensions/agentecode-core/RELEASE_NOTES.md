# Novidades do AgenteCode

Uma seção por versão, da mais nova para a mais antiga. O título de cada seção precisa ter o formato `## vX.Y.Z - data`.

## v1.0.0 - 20/10/2026

A primeira versão estável do AgenteCode: uma IDE pensada para trabalhar com agentes, com o Claude Code embutido.

### Atualização dentro da IDE
- A IDE avisa quando há uma versão nova: aparece uma bolinha na engrenagem, no mesmo estilo do VS Code.
- **Check for Updates...** na engrenagem verifica na hora. A verificação automática acontece ao abrir e uma vez por dia, e pode ser desligada em `update.mode`.
- **Download Update** baixa o instalador dentro da IDE, com progresso, e confere o SHA-256 contra o arquivo publicado na Release.
- **Restart to Update** fecha a IDE normalmente, instala e abre a nova versão sozinha. Se algo falhar, a página da versão abre no navegador.
- Depois de atualizar, esta tela de novidades abre uma vez. Para vê-la de novo: **AgenteCode: Mostrar notas da versão**.

### Sessões do agente
- Novo painel **Sessões do agente** na barra lateral direita, ao lado do Claude Code.
- Lista as conversas do projeto, com **busca por texto** dentro delas.
- **Retomar** abre a conversa no Claude Code do painel lateral.
- **Exportar** gera um arquivo Markdown com a conversa, as ferramentas usadas e o resultado de cada uma.
- **Excluir** move a sessão para a Lixeira do Windows, junto com os arquivos auxiliares (tecla `Delete`, seleção múltipla). Sessões em uso ficam protegidas.

### Voltar arquivos (checkpoint)
- Dentro de cada sessão, o botão **Voltar arquivos para antes desta resposta** desfaz o que o agente fez nos arquivos.
- Mostra o que vai mudar, com a diferença de cada arquivo, e pede confirmação.
- Guarda o estado atual antes de voltar: **AgenteCode: Desfazer a última volta de arquivos** desfaz a volta.
- Limites: não desfaz o que foi feito por comandos de terminal, nem volta a conversa.

### Base da IDE
- Quatro temas próprios (Deep Teal, Eficaz, Everforest e One Dark Pro), cada um com a versão Clean, sem divisórias.
- Claude Code embutido, abrindo na barra lateral direita (`Ctrl+L`).
- Extensões pelo Open VSX, sem o Copilot e sem telemetria no núcleo da IDE.
- Menu da engrenagem com a versão e o diálogo Sobre.
