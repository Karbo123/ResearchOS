import { database, migrate } from './database.js'

await migrate()
console.log('Database migration 0001-native-typescript applied.')
await database.close()
