# Segurança

- Segredos nunca entram no repositório. Use variáveis de ambiente e os segredos do GitHub; `.env.example` lista só os nomes.
- Segredo exposto (commit, chat, captura de tela): revogue ou rotacione imediatamente e depois avise o dono do produto. Só remover do histórico não basta.
- Dados pessoais de clientes nunca entram no grafo público nem em prompts.
- O isolamento entre clientes é por RLS. Teste sempre com o papel `menlo_app`, nunca com superusuário.
- Repositório privado. Reporte problemas de segurança diretamente ao dono do produto, não em issues públicas.
