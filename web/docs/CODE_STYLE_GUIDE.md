# Guia de Codigo Limpio

## Nombres
- Usa nombres descriptivos y consistentes en todo el modulo.
- Evita abreviaciones innecesarias.
- Nombra por intencion de negocio, no por implementacion tecnica.

## Funciones
- Cada funcion debe tener una sola responsabilidad.
- Mantener funciones pequenas y faciles de leer.
- Evitar firmas con mas de 3 parametros: usa objetos comando.

## Diseno
- Bajo acoplamiento y alta cohesion por modulo.
- Prefiere composicion sobre herencia.
- Aplica SOLID cuando la abstraccion aporte claridad.

## Errores
- No ocultes errores ni uses catch vacios.
- Usa excepciones tipadas de aplicacion/dominio.
- Mapea errores tecnicos en adaptadores de entrada/salida.

## Estilo
- Mantener formato consistente y lectura de arriba hacia abajo.
- Evitar valores magicos: mover constantes a nivel de dominio.
- Comentarios solo para explicar por que, no que.

## Refactor
- Si el codigo es dificil de entender, debe refactorizarse.
- Evita duplicacion (DRY) y extrae utilidades compartidas.