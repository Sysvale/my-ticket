// Formas de chamar a atenção além do banner do Windows (que o sistema pode esconder).
//  - flash:  pisca o Chrome na barra de tarefas até a janela receber foco;
//  - sticky: o aviso fica na tela até a pessoa fechar (requireInteraction), em vez de sumir em segundos.
export const normalizeAttention = (a) => ({ flash: a?.flash !== false, sticky: Boolean(a?.sticky) });
