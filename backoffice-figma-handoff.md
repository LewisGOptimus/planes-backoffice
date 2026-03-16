# Backoffice UI - Handoff para Figma

## 1) Frames recomendados
- Desktop: `1440 x 1024`
- Tablet: `1024 x 1366`
- Mobile: `390 x 844`

## 2) Grid y espaciado
- Grid desktop: 12 columnas, `72px` de margen, `20px` gutter.
- Grid tablet: 8 columnas, `32px` margen, `16px` gutter.
- Grid mobile: 4 columnas, `16px` margen, `12px` gutter.
- Sistema base de spacing: `4, 8, 12, 16, 24, 32`.

## 3) Tokens visuales
- `bg / #F4F2EB`
- `surface / #FFFCF5`
- `surface-2 / #FDF7EA`
- `ink / #1A1F2A`
- `muted / #62687A`
- `line / #E8DFCD`
- `brand / #0F766E`
- `brand-soft / #D6F2ED`
- `danger / #EF4444`
- `warn / #F59E0B`
- `ok / #16A34A`

## 4) Tipografía
- Principal: `Manrope`
- Titulares numéricos: `Space Grotesk`
- Escala sugerida:
  - H1: `28/34`, weight `800`
  - H2: `18/24`, weight `800`
  - Body: `14/20`, weight `500`
  - Caption: `12/16`, weight `700`

## 5) Estructura del layout
- Contenedor general: 2 columnas.
- Sidebar: `280px` (navegación, branding, quick action card).
- Main panel: área de trabajo con:
  - Topbar (buscador + acciones)
  - 4 KPI cards
  - Tabla de operaciones
  - Panel de actividad lateral

## 6) Componentes clave para crear en Figma
- Nav Item (default, hover, active, badge).
- KPI Card (label, value, trend positive/warn/danger).
- Button (default y primary).
- Status Pill (pagado, revisión, vencido).
- Data table row.
- Activity item.

## 7) Estados y microinteracciones
- Hover en nav: fondo `surface-2` + borde `line`.
- Nav active: fondo `brand-soft`.
- Botón primario: `brand` con texto blanco.
- Entrada de contenido: animación vertical sutil (6-10px).
- Stagger de cards: aparición secuencial.

## 8) Notas de estilo
- Evitar look corporativo plano; usar atmósfera cálida con fondos crema.
- Contraste alto en datos críticos.
- Bordes suaves (`12-24px`) + sombras ligeras.
- Priorizar legibilidad para uso operativo.
