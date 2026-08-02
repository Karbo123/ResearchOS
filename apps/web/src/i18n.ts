import { useSyncExternalStore } from 'react'

export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'es'

export const DEFAULT_LOCALE: Locale = 'zh-CN'

export const LOCALE_OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

const STORAGE_KEY = 'researchos.locale'

const zhCN = {
  'nav.overview': '项目概述',
  'nav.relatedWork': '相关工作调研',
  'nav.implementation': '实验实现',
  'nav.paper': '学术论文撰写',
  'nav.workspaceArea': '科研工作区',
  'nav.currentWorkspace': '当前工作区页面',
  'group.overviewIdea': 'Idea 讨论',
  'group.overviewSpec': '项目规格',
  'group.overviewInnovation': '创新与边界',
  'group.overviewProgress': '进度与待决策',
  'group.overviewReports': '日报/周报与导师反馈',
  'group.relatedSearch': '种子与文献检索',
  'group.relatedStatus': '研究现状与引用图',
  'group.implRelated': '相关工作实现',
  'group.implMethod': '本方法实现',
  'group.paperWriting': '论文写作与编译',
  'tab.overview': 'Idea 讨论',
  'tab.overviewSpec': '项目描述与研究问题',
  'tab.overviewInnovation': '创新点与边界',
  'tab.overviewProgress': '项目进度与待决策',
  'tab.dailyReports': '日报',
  'tab.weeklyReports': '周报',
  'tab.feedbackInbox': '导师反馈',
  'tab.feedbackAudit': '决策与审计',
  'tab.literature': '种子与文献检索',
  'tab.researchStatus': '研究现状',
  'tab.citationGraph': '引用图',
  'tab.reproduction': '代码复现',
  'tab.comparison': '效果比较',
  'tab.methodDesign': '方法设计',
  'tab.codeWorkspace': '代码工作区',
  'tab.policies': '变更与审批',
  'tab.approvals': 'Git 与备份',
  'tab.experiments': '实验计划与结果',
  'tab.experimentQueue': '运行队列',
  'tab.experimentMetrics': '指标统计',
  'tab.artifacts': '结果与可视化',
  'tab.lineage': '实验谱系',
  'tab.paperProject': '论文项目',
  'tab.paperOutline': '大纲与章节',
  'tab.paperCitations': '引用与 BibTeX',
  'tab.paperFigures': '图表选择与插入',
  'tab.paperData': '实验数据选择与引用',
  'tab.paperCompile': 'LaTeX 编译',
  'tab.paperReview': 'PDF 呈现与审阅',
  'topbar.connected': '已连接',
  'topbar.offline': '离线',
  'topbar.connecting': '连接中',
  'topbar.refresh': '刷新',
  'topbar.language': '界面语言',
  'topbar.theme': '界面主题',
  'sidebar.newProject': '新研究项目',
  'sidebar.projects': '项目',
  'sidebar.noProjects': '暂无项目',
  'sidebar.mastraWorkflows': 'Mastra Workflows',
  'sidebar.memoryGraph': '项目记忆图',
  'sidebar.modelSettings': '模型配置',
  'theme.light': '浅色',
  'theme.dark': '暗色',
  'theme.colorful': '彩色',
  'projectChat': '项目对话',
  'common.innerPages': '内部页面',
  'common.cancel': '取消',
}

export type TranslationKey = keyof typeof zhCN

const zhTW: Record<TranslationKey, string> = {
  'nav.overview': '專案概覽',
  'nav.relatedWork': '相關工作調研',
  'nav.implementation': '實驗實作',
  'nav.paper': '學術論文撰寫',
  'nav.workspaceArea': '科研工作區',
  'nav.currentWorkspace': '目前工作區頁面',
  'group.overviewIdea': 'Idea 討論',
  'group.overviewSpec': '專案規格',
  'group.overviewInnovation': '創新與邊界',
  'group.overviewProgress': '進度與待決策',
  'group.overviewReports': '日報/週報與導師回饋',
  'group.relatedSearch': '種子與文獻檢索',
  'group.relatedStatus': '研究現況與引用圖',
  'group.implRelated': '相關工作實作',
  'group.implMethod': '本方法實作',
  'group.paperWriting': '論文寫作與編譯',
  'tab.overview': 'Idea 討論',
  'tab.overviewSpec': '專案描述與研究問題',
  'tab.overviewInnovation': '創新點與邊界',
  'tab.overviewProgress': '專案進度與待決策',
  'tab.dailyReports': '日報',
  'tab.weeklyReports': '週報',
  'tab.feedbackInbox': '導師回饋',
  'tab.feedbackAudit': '決策與稽核',
  'tab.literature': '種子與文獻檢索',
  'tab.researchStatus': '研究現況',
  'tab.citationGraph': '引用圖',
  'tab.reproduction': '程式碼重現',
  'tab.comparison': '效果比較',
  'tab.methodDesign': '方法設計',
  'tab.codeWorkspace': '程式碼工作區',
  'tab.policies': '變更與審批',
  'tab.approvals': 'Git 與備份',
  'tab.experiments': '實驗計畫與結果',
  'tab.experimentQueue': '執行佇列',
  'tab.experimentMetrics': '指標統計',
  'tab.artifacts': '結果與視覺化',
  'tab.lineage': '實驗譜系',
  'tab.paperProject': '論文專案',
  'tab.paperOutline': '大綱與章節',
  'tab.paperCitations': '引用與 BibTeX',
  'tab.paperFigures': '圖表選擇與插入',
  'tab.paperData': '實驗資料選擇與引用',
  'tab.paperCompile': 'LaTeX 編譯',
  'tab.paperReview': 'PDF 呈現與審閱',
  'topbar.connected': '已連線',
  'topbar.offline': '離線',
  'topbar.connecting': '連線中',
  'topbar.refresh': '重新整理',
  'topbar.language': '介面語言',
  'topbar.theme': '介面主題',
  'sidebar.newProject': '新研究專案',
  'sidebar.projects': '專案',
  'sidebar.noProjects': '尚無專案',
  'sidebar.mastraWorkflows': 'Mastra Workflows',
  'sidebar.memoryGraph': '專案記憶圖',
  'sidebar.modelSettings': '模型設定',
  'theme.light': '淺色',
  'theme.dark': '暗色',
  'theme.colorful': '彩色',
  'projectChat': '專案對話',
  'common.innerPages': '內部頁面',
  'common.cancel': '取消',
}

const en: Record<TranslationKey, string> = {
  'nav.overview': 'Project Overview',
  'nav.relatedWork': 'Related Work',
  'nav.implementation': 'Experiment Implementation',
  'nav.paper': 'Academic Paper Writing',
  'nav.workspaceArea': 'Research workspace',
  'nav.currentWorkspace': 'Current workspace pages',
  'group.overviewIdea': 'Idea Discussion',
  'group.overviewSpec': 'Project Specification',
  'group.overviewInnovation': 'Innovation and Boundaries',
  'group.overviewProgress': 'Progress and Decisions',
  'group.overviewReports': 'Reports and Mentor Feedback',
  'group.relatedSearch': 'Seeds and Literature Search',
  'group.relatedStatus': 'Research Status and Citation Graph',
  'group.implRelated': 'Related Work Implementation',
  'group.implMethod': 'Our Method Implementation',
  'group.paperWriting': 'Writing and Compilation',
  'tab.overview': 'Idea Discussion',
  'tab.overviewSpec': 'Description and Research Question',
  'tab.overviewInnovation': 'Innovation and Boundaries',
  'tab.overviewProgress': 'Progress and Decisions',
  'tab.dailyReports': 'Daily Report',
  'tab.weeklyReports': 'Weekly Report',
  'tab.feedbackInbox': 'Mentor Feedback',
  'tab.feedbackAudit': 'Decisions and Audit',
  'tab.literature': 'Seeds and Literature Search',
  'tab.researchStatus': 'Research Status',
  'tab.citationGraph': 'Citation Graph',
  'tab.reproduction': 'Code Reproduction',
  'tab.comparison': 'Effect Comparison',
  'tab.methodDesign': 'Method Design',
  'tab.codeWorkspace': 'Code Workspace',
  'tab.policies': 'Changes and Approvals',
  'tab.approvals': 'Git and Backups',
  'tab.experiments': 'Plans and Results',
  'tab.experimentQueue': 'Run Queue',
  'tab.experimentMetrics': 'Metric Statistics',
  'tab.artifacts': 'Results and Visualization',
  'tab.lineage': 'Experiment Lineage',
  'tab.paperProject': 'Paper Project',
  'tab.paperOutline': 'Outline and Chapters',
  'tab.paperCitations': 'Citations and BibTeX',
  'tab.paperFigures': 'Figure Selection and Insertion',
  'tab.paperData': 'Experiment Data Selection',
  'tab.paperCompile': 'LaTeX Compilation',
  'tab.paperReview': 'PDF Review',
  'topbar.connected': 'Connected',
  'topbar.offline': 'Offline',
  'topbar.connecting': 'Connecting',
  'topbar.refresh': 'Refresh',
  'topbar.language': 'Interface language',
  'topbar.theme': 'Interface theme',
  'sidebar.newProject': 'New Research Project',
  'sidebar.projects': 'Projects',
  'sidebar.noProjects': 'No projects yet',
  'sidebar.mastraWorkflows': 'Mastra Workflows',
  'sidebar.memoryGraph': 'Project Memory Graph',
  'sidebar.modelSettings': 'Model Settings',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.colorful': 'Colorful',
  'projectChat': 'Project chat',
  'common.innerPages': 'Inner pages',
  'common.cancel': 'Cancel',
}

const es: Record<TranslationKey, string> = {
  'nav.overview': 'Resumen del proyecto',
  'nav.relatedWork': 'Trabajo relacionado',
  'nav.implementation': 'Implementación experimental',
  'nav.paper': 'Redacción académica',
  'nav.workspaceArea': 'Espacio de investigación',
  'nav.currentWorkspace': 'Páginas del espacio actual',
  'group.overviewIdea': 'Discusión de la idea',
  'group.overviewSpec': 'Especificación del proyecto',
  'group.overviewInnovation': 'Innovación y límites',
  'group.overviewProgress': 'Progreso y decisiones',
  'group.overviewReports': 'Informes y comentarios del tutor',
  'group.relatedSearch': 'Búsqueda de fuentes',
  'group.relatedStatus': 'Estado de la investigación y grafo de citas',
  'group.implRelated': 'Implementación de trabajos relacionados',
  'group.implMethod': 'Implementación de nuestro método',
  'group.paperWriting': 'Escritura y compilación',
  'tab.overview': 'Discusión de la idea',
  'tab.overviewSpec': 'Descripción y pregunta de investigación',
  'tab.overviewInnovation': 'Innovación y límites',
  'tab.overviewProgress': 'Progreso y decisiones',
  'tab.dailyReports': 'Informe diario',
  'tab.weeklyReports': 'Informe semanal',
  'tab.feedbackInbox': 'Comentarios del tutor',
  'tab.feedbackAudit': 'Decisiones y auditoría',
  'tab.literature': 'Búsqueda de fuentes',
  'tab.researchStatus': 'Estado de la investigación',
  'tab.citationGraph': 'Grafo de citas',
  'tab.reproduction': 'Reproducción de código',
  'tab.comparison': 'Comparación de resultados',
  'tab.methodDesign': 'Diseño del método',
  'tab.codeWorkspace': 'Espacio de código',
  'tab.policies': 'Cambios y aprobaciones',
  'tab.approvals': 'Git y copias de seguridad',
  'tab.experiments': 'Planes y resultados',
  'tab.experimentQueue': 'Cola de ejecución',
  'tab.experimentMetrics': 'Estadísticas de métricas',
  'tab.artifacts': 'Resultados y visualización',
  'tab.lineage': 'Linaje experimental',
  'tab.paperProject': 'Proyecto de artículo',
  'tab.paperOutline': 'Esquema y capítulos',
  'tab.paperCitations': 'Citas y BibTeX',
  'tab.paperFigures': 'Selección e inserción de figuras',
  'tab.paperData': 'Selección de datos experimentales',
  'tab.paperCompile': 'Compilación LaTeX',
  'tab.paperReview': 'Revisión del PDF',
  'topbar.connected': 'Conectado',
  'topbar.offline': 'Sin conexión',
  'topbar.connecting': 'Conectando',
  'topbar.refresh': 'Actualizar',
  'topbar.language': 'Idioma de la interfaz',
  'topbar.theme': 'Tema de la interfaz',
  'sidebar.newProject': 'Nuevo proyecto de investigación',
  'sidebar.projects': 'Proyectos',
  'sidebar.noProjects': 'Aún no hay proyectos',
  'sidebar.mastraWorkflows': 'Mastra Workflows',
  'sidebar.memoryGraph': 'Grafo de memoria del proyecto',
  'sidebar.modelSettings': 'Configuración de modelos',
  'theme.light': 'Claro',
  'theme.dark': 'Oscuro',
  'theme.colorful': 'Colorido',
  'projectChat': 'Chat del proyecto',
  'common.innerPages': 'Páginas internas',
  'common.cancel': 'Cancelar',
}

export const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en,
  es,
}

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  const locale: Locale = stored === 'zh-TW' || stored === 'en' || stored === 'es' ? stored : DEFAULT_LOCALE
  window.document.documentElement.lang = locale
  return locale
}

let currentLocale: Locale = initialLocale()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale) {
  if (locale === currentLocale) return
  currentLocale = locale
  window.localStorage.setItem(STORAGE_KEY, locale)
  window.document.documentElement.lang = locale
  listeners.forEach(listener => listener())
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}

export function useTranslation() {
  const locale = useLocale()
  const t = (key: TranslationKey) => dictionaries[locale][key] ?? zhCN[key] ?? key
  return { locale, t, setLocale }
}
