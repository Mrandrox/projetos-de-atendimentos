# Portuga Pedidos — app instalável para Android

O aplicativo mantém o HTML original e acrescenta:

- instalação como app pelo Google Chrome no Android;
- funcionamento offline depois do primeiro carregamento;
- cadastro de comandas por cliente, agrupando pedidos novos com o mesmo nome enquanto a conta estiver aberta;
- seleção de produtos em cartões separados por categoria;
- hierarquia visual e alvos de toque maiores;
- exportação e importação de backup local.

## Publicar em um endereço seguro

O Chrome precisa abrir o app em um endereço HTTPS para instalar o PWA e usar a conexão Bluetooth. Para publicar no GitHub Pages:

1. Coloque o conteúdo desta pasta na raiz do repositório **projetos-de-atendimentos**.
2. No GitHub, abra **Settings → Pages** e escolha publicar a branch **main**, pasta **/(root)**.
3. Quando o GitHub mostrar o endereço do site, abra-o no Chrome do Android.
4. No menu do Chrome, escolha **Instalar app** ou **Adicionar à tela inicial**.

Também pode publicar esta pasta em outra hospedagem estática que forneça HTTPS. Abrir o arquivo HTML diretamente pelo gerenciador de arquivos não instala o PWA nem habilita Web Bluetooth.

## Bluetooth e impressão

A conexão Bluetooth do app continua usando a API Web Bluetooth do Chrome. No Android, abra a conexão a partir do botão do próprio app e selecione a impressora. A impressora precisa oferecer um serviço BLE/GATT compatível com a API de impressão usada pelo app. Impressoras Bluetooth clássicas podem exigir o aplicativo RawBT, cuja alternativa já existia no HTML original.

A conexão requer Chrome compatível, HTTPS e uma ação explícita do usuário. A disponibilidade também depende do modelo do aparelho e da impressora.

## Dados e backup

Perfil, logo, produtos, pedidos e comandas são guardados no armazenamento local do navegador neste endereço. Eles não sincronizam automaticamente entre celulares. Use **Comandas → Exportar backup** para salvar um arquivo JSON; em outro navegador ou endereço, use **Importar backup**.

O navegador separa dados por endereço. Ao publicar em um domínio novo, o armazenamento do site anterior não é copiado automaticamente. Importe um backup para levar esses dados.

## Arquivos

- **index.html**: app original com os complementos de instalação.
- **enhancements.js**: comandas, menu por categoria, backup e hierarquia de botões.
- **manifest.webmanifest**: nome, cores e ícones do app.
- **sw.js**: cache do app para uso offline.
- **icons/**: ícones extraídos da identidade visual já incluída no HTML.
