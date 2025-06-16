import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  user: 'postgres',
  host: 'yamabiko.proxy.rlwy.net',
  database: 'railway', // arba 'pgvector' – priklauso nuo pavadinimo, kurį matai
  password: '0Gn7DYdPcIe_qDXCRo9Fi9hhp5pQNI~i',
  port: 46137,
});

export default pool;
