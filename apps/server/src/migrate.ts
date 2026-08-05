import { database, migrate, migrateProjectPrimaryKeyToSlug } from './database.js'
import { migrateProjectSlugs } from './project-slug-migration.js'

await migrate()
await migrateProjectSlugs()
await migrateProjectPrimaryKeyToSlug()
console.log('Database migration 0001-native-typescript applied.')
await database.close()
