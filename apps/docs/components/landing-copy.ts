export const locales = ['en', 'ru', 'de', 'fr', 'zh'] as const;

export type Locale = (typeof locales)[number];

export const localeHref: Record<Locale, string> = {
  en: '/',
  ru: '/ru/',
  de: '/de/',
  fr: '/fr/',
  zh: '/zh/',
};

export const localeName: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
  de: 'Deutsch',
  fr: 'Français',
  zh: '中文',
};

export const localeFlag: Record<Locale, string> = {
  en: '🇬🇧',
  ru: '🇷🇺',
  de: '🇩🇪',
  fr: '🇫🇷',
  zh: '🇨🇳',
};

export const localeShort: Record<Locale, string> = {
  en: 'EN',
  ru: 'RU',
  de: 'DE',
  fr: 'FR',
  zh: 'ZH',
};

export interface CompareRowCopy {
  feature: string;
  primary: string;
  secondary: string;
  secondaryTooltip?: {
    title: string;
    description: string;
  };
}

export interface LandingCopy {
  meta: {
    title: string;
    description: string;
  };
  languageSwitcher: string;
  nav: {
    features: string;
    compare: string;
    docs: string;
    faq: string;
  };
  hero: {
    titleLead: string;
    titleAccent: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
    agentCta: string;
    agentCopied: string;
    installLead: string;
    imageAlt: string;
  };
  features: {
    heading: string;
    items: {
      title: string;
      description: string;
    }[];
  };
  problem: {
    heading: string;
    description: string;
    resultNote: string;
  };
  compare: {
    heading: string;
    description: string;
    primaryLabel: string;
    secondaryLabel: string;
    rows: CompareRowCopy[];
  };
  faq: {
    heading: string;
    items: {
      question: string;
      answer: string;
    }[];
  };
  footer: {
    tagline: string;
    product: string;
    docs: string;
    project: string;
    features: string;
    compare: string;
    faq: string;
    overview: string;
    quickstart: string;
    github: string;
    issues: string;
    legal: string;
    status: string;
  };
}

export const landingCopy: Record<Locale, LandingCopy> = {
  en: {
    meta: {
      title: 'Mink 0.9: repository control plane',
      description:
        'Run cached workflows, persistent services, monorepo tasks, CI jobs, and agent tools from one local, cross-platform repository control plane.',
    },
    languageSwitcher: 'Change language',
    nav: {
      features: 'Features',
      compare: 'Compare',
      docs: 'Docs',
      faq: 'FAQ',
    },
    hero: {
      titleLead: "Your repo's commands,",
      titleAccent: 'without the README hunt.',
      description:
        'Mink discovers the tools already in your repository, then adds typed inputs, cached workflows, persistent services, monorepo selection, CI reports, and bounded agent access — locally, with no account or telemetry.',
      primaryCta: 'Get Mink running',
      secondaryCta: 'See how it works',
      agentCta: 'Copy agent prompt',
      agentCopied: 'Prompt copied',
      installLead: 'Install once, then run',
      imageAlt: 'Acme Checkout in Mink with two services running',
    },
    features: {
      heading: 'Built from files you already have.',
      items: [
        {
          title: 'Find what already runs',
          description:
            'Mink reads package scripts, Make targets, and shell files. You do not need to move commands into a new task file.',
        },
        {
          title: 'Make the details explicit',
          description:
            'Typed parameter forms, defaults, and presets help every teammate run the same command with the right values.',
        },
        {
          title: 'Connect the work',
          description:
            'Run dependency graphs with bounded concurrency. Nested pipelines stay readable.',
        },
        {
          title: 'Keep services in view',
          description:
            'Start a local service, wait until it is ready, then restart it without leaving the palette.',
        },
        {
          title: 'Keys first',
          description: 'Every tab lists its own shortcuts. Press ? to see them.',
        },
        {
          title: 'Nine themes, five languages',
          description:
            'Stone is the default. Change the theme or interface language in Settings and it applies immediately.',
        },
      ],
    },
    problem: {
      heading: 'A large repo is hard to run.',
      description:
        'It can hold dozens of scripts and several READMEs. Newcomers guess which command to run, and the person who knows is often busy.',
      resultNote: 'one palette for every command',
    },
    compare: {
      heading: 'Keep the scripts. Add the missing parts.',
      description:
        'Mink reads the commands you already have and adds typed parameters, dependency graphs, services, and one palette to find them.',
      primaryLabel: 'Mink',
      secondaryLabel: 'npm scripts',
      rows: [
        {
          feature: 'Uses commands already in the repo',
          primary: 'Reads package scripts, Make targets, and shell files',
          secondary: 'Only package scripts',
        },
        {
          feature: 'Typed parameters',
          primary: 'Forms with types, defaults, and presets',
          secondary: 'Raw shell flags',
          secondaryTooltip: {
            title: 'Parameters',
            description: 'npm passes extra arguments as strings. Each script has to validate them.',
          },
        },
        {
          feature: 'Pipelines',
          primary: 'Dependency graphs with bounded concurrency',
          secondary: 'Sequential chains',
          secondaryTooltip: {
            title: 'No dependency graph',
            description:
              'npm run-script has no dependency graph. Parallel work needs a separate tool.',
          },
        },
        {
          feature: 'Services',
          primary: 'Start, wait for readiness, restart',
          secondary: 'Not included',
        },
        {
          feature: 'Keyboard-first palette',
          primary: 'Yes, with a ? shortcut overlay',
          secondary: 'No terminal UI',
        },
        {
          feature: 'Interface languages',
          primary: 'English, Русский, Deutsch, Français, 中文',
          secondary: 'English',
        },
      ],
    },
    faq: {
      heading: 'Questions',
      items: [
        {
          question: 'Does Mink need a server or an account?',
          answer: 'No. Mink runs on your machine and reads the commands in your repository.',
        },
        {
          question: 'Will it work with our current setup?',
          answer:
            'Mink reads package scripts, Make targets, and shell files. Add a mink.yml only when a command needs parameters, a clearer name, or a workflow.',
        },
        {
          question: 'Which platforms are supported?',
          answer:
            'Windows, Linux and macOS with Node.js 24 or newer. Windows requires Windows PowerShell.',
        },
        {
          question: 'Can I use Mink in my language?',
          answer:
            'Yes. The interface comes in English, Русский, Deutsch, Français, and 中文. Pick a language in Settings.',
        },
        {
          question: 'Where does my data go?',
          answer: 'Mink runs locally. It does not need an account or a hosted service.',
        },
        {
          question: 'Is Mink ready for production?',
          answer:
            'Mink is alpha 0.1 under the MIT license. Build it from this repository; the packages are not published yet.',
        },
      ],
    },
    footer: {
      tagline: 'Every command in your repo, in one palette.',
      product: 'Product',
      docs: 'Docs',
      project: 'Project',
      features: 'Features',
      compare: 'Compare',
      faq: 'FAQ',
      overview: 'Overview',
      quickstart: 'Quick start',
      github: 'GitHub',
      issues: 'Issues',
      legal: 'MIT license',
      status: 'Alpha 0.1',
    },
  },
  ru: {
    meta: {
      title: 'Mink: терминальная палитра команд',
      description:
        'Находите, настраивайте и запускайте команды, пайплайны и сервисы из вашего репозитория в одной терминальной палитре.',
    },
    languageSwitcher: 'Сменить язык',
    nav: {
      features: 'Возможности',
      compare: 'Сравнение',
      docs: 'Документация',
      faq: 'FAQ',
    },
    hero: {
      titleLead: 'Команды вашего репозитория,',
      titleAccent: 'без поисков в README.',
      description:
        'Mink находит package-скрипты, цели Make и shell-файлы, которые уже есть в вашем репозитории. Запускайте их из одной терминальной палитры: с типизированными параметрами и предпросмотром команды.',
      primaryCta: 'Запустить Mink',
      secondaryCta: 'Как это работает',
      agentCta: 'Скопировать промпт для агента',
      agentCopied: 'Промпт скопирован',
      installLead: 'Установите один раз, затем запустите',
      imageAlt: 'Acme Checkout в Mink с двумя запущенными сервисами',
    },
    features: {
      heading: 'Собрано из файлов, которые у вас уже есть.',
      items: [
        {
          title: 'Найдите то, что уже запускается',
          description:
            'Mink читает package-скрипты, цели Make и shell-файлы. Переносить команды в новый файл задач не нужно.',
        },
        {
          title: 'Сделайте детали явными',
          description:
            'Формы с типами, значения по умолчанию и пресеты помогают всей команде запускать одну и ту же команду с правильными значениями.',
        },
        {
          title: 'Свяжите задачи',
          description:
            'Запускайте графы зависимостей с ограниченной параллельностью. Вложенные пайплайны остаются читаемыми.',
        },
        {
          title: 'Держите сервисы под рукой',
          description:
            'Запустите локальный сервис, дождитесь готовности и перезапустите его, не выходя из палитры.',
        },
        {
          title: 'Сначала клавиши',
          description: 'У каждой вкладки свои сочетания клавиш. Нажмите ?, чтобы увидеть их.',
        },
        {
          title: 'Девять тем, пять языков',
          description:
            'По умолчанию включена Stone. Смените тему или язык интерфейса в настройках, и изменения применятся сразу.',
        },
      ],
    },
    problem: {
      heading: 'Большим репозиторием трудно управлять.',
      description:
        'В нём десятки скриптов и несколько README. Новый человек угадывает, какую команду запускать, а тот, кто знает, часто занят.',
      resultNote: 'одна палитра для всех команд',
    },
    compare: {
      heading: 'Оставьте скрипты. Добавьте недостающее.',
      description:
        'Mink читает уже существующие команды и добавляет типизированные параметры, графы зависимостей, сервисы и одну палитру, чтобы их находить.',
      primaryLabel: 'Mink',
      secondaryLabel: 'npm-скрипты',
      rows: [
        {
          feature: 'Использует команды из репозитория',
          primary: 'Читает package-скрипты, цели Make и shell-файлы',
          secondary: 'Только package-скрипты',
        },
        {
          feature: 'Типизированные параметры',
          primary: 'Формы с типами, значениями по умолчанию и пресетами',
          secondary: 'Сырые флаги shell',
          secondaryTooltip: {
            title: 'Параметры',
            description:
              'npm передаёт дополнительные аргументы строками. Каждый скрипт должен сам их проверять.',
          },
        },
        {
          feature: 'Пайплайны',
          primary: 'Графы зависимостей с ограниченной параллельностью',
          secondary: 'Последовательные цепочки',
          secondaryTooltip: {
            title: 'Нет графа зависимостей',
            description:
              'У npm run-script нет графа зависимостей. Для параллельной работы нужен отдельный инструмент.',
          },
        },
        {
          feature: 'Сервисы',
          primary: 'Запуск, ожидание готовности, перезапуск',
          secondary: 'Не входит',
        },
        {
          feature: 'Палитра, управляемая с клавиатуры',
          primary: 'Да, со справкой по ?',
          secondary: 'Нет терминального интерфейса',
        },
        {
          feature: 'Языки интерфейса',
          primary: 'English, Русский, Deutsch, Français, 中文',
          secondary: 'Английский',
        },
      ],
    },
    faq: {
      heading: 'Вопросы',
      items: [
        {
          question: 'Mink требует сервер или аккаунт?',
          answer: 'Нет. Mink работает на вашей машине и читает команды из репозитория.',
        },
        {
          question: 'Подойдёт ли это для нашего проекта?',
          answer:
            'Mink читает package-скрипты, цели Make и shell-файлы. mink.yml нужен, только если команде требуются параметры, понятное имя или рабочий процесс.',
        },
        {
          question: 'Какие платформы поддерживаются?',
          answer:
            'Windows, Linux и macOS с Node.js 24 или новее. На Windows нужен Windows PowerShell.',
        },
        {
          question: 'Можно пользоваться Mink на своём языке?',
          answer:
            'Да. Интерфейс доступен на английском, русском, немецком, французском и китайском. Язык выбирается в настройках.',
        },
        {
          question: 'Куда попадают мои данные?',
          answer: 'Mink работает локально. Аккаунт и размещённый сервис не нужны.',
        },
        {
          question: 'Mink готов к продакшену?',
          answer:
            'Mink сейчас в статусе альфа 0.1 под лицензией MIT. Соберите его из этого репозитория; пакеты пока не опубликованы.',
        },
      ],
    },
    footer: {
      tagline: 'Все команды вашего репозитория в одной палитре.',
      product: 'Продукт',
      docs: 'Документация',
      project: 'Проект',
      features: 'Возможности',
      compare: 'Сравнение',
      faq: 'FAQ',
      overview: 'Обзор',
      quickstart: 'Быстрый старт',
      github: 'GitHub',
      issues: 'Issues',
      legal: 'Лицензия MIT',
      status: 'Alpha 0.1',
    },
  },
  de: {
    meta: {
      title: 'Mink: Terminal-Befehlspalette',
      description:
        'Finde, konfiguriere und starte Befehle, Pipelines und Services aus deinem Repository in einer Terminal-Palette.',
    },
    languageSwitcher: 'Sprache ändern',
    nav: {
      features: 'Funktionen',
      compare: 'Vergleich',
      docs: 'Doku',
      faq: 'FAQ',
    },
    hero: {
      titleLead: 'Die Befehle aus deinem Repo,',
      titleAccent: 'ohne README-Suche.',
      description:
        'Mink findet die package-Skripte, Make-Ziele und Shell-Dateien, die bereits in deinem Repository liegen. Starte sie aus einer Terminal-Palette, mit typisierten Parametern und einer Vorschau, was ausgeführt wird.',
      primaryCta: 'Mink starten',
      secondaryCta: 'So funktioniert es',
      agentCta: 'Agenten-Prompt kopieren',
      agentCopied: 'Prompt kopiert',
      installLead: 'Einmal installieren, dann starten:',
      imageAlt: 'Acme Checkout in Mink mit zwei laufenden Services',
    },
    features: {
      heading: 'Gebaut aus Dateien, die du schon hast.',
      items: [
        {
          title: 'Finde, was bereits läuft',
          description:
            'Mink liest package-Skripte, Make-Ziele und Shell-Dateien. Du musst keine Befehle in eine neue Task-Datei verschieben.',
        },
        {
          title: 'Mach die Details eindeutig',
          description:
            'Formulare mit Typen, Standardwerten und Presets sorgen dafür, dass alle im Team denselben Befehl mit den richtigen Werten starten.',
        },
        {
          title: 'Verbinde die Arbeit',
          description:
            'Führe Abhängigkeitsgraphen mit begrenzter Parallelität aus. Verschachtelte Pipelines bleiben lesbar.',
        },
        {
          title: 'Behalte Services im Blick',
          description:
            'Starte einen lokalen Service, warte auf seine Bereitschaft und starte ihn neu, ohne die Palette zu verlassen.',
        },
        {
          title: 'Tasten zuerst',
          description: 'Jeder Tab zeigt seine eigenen Tastenkürzel. Drücke ?, um sie zu sehen.',
        },
        {
          title: 'Neun Themes, fünf Sprachen',
          description:
            'Stone ist die Standardeinstellung. Ändere Theme oder Sprache in den Einstellungen, und beides gilt sofort.',
        },
      ],
    },
    problem: {
      heading: 'Ein großes Repo lässt sich schwer bedienen.',
      description:
        'Dutzende Skripte und mehrere READMEs. Neue im Team raten, welcher Befehl der richtige ist, und die Person, die es weiß, ist oft beschäftigt.',
      resultNote: 'eine Palette für alle Befehle',
    },
    compare: {
      heading: 'Behalte die Skripte. Ergänze, was fehlt.',
      description:
        'Mink liest die Befehle, die du schon hast, und ergänzt typisierte Parameter, Abhängigkeitsgraphen, Services und eine Palette, um sie zu finden.',
      primaryLabel: 'Mink',
      secondaryLabel: 'npm-Skripte',
      rows: [
        {
          feature: 'Nutzt Befehle, die schon im Repo liegen',
          primary: 'Liest package-Skripte, Make-Ziele und Shell-Dateien',
          secondary: 'Nur package-Skripte',
        },
        {
          feature: 'Typisierte Parameter',
          primary: 'Formulare mit Typen, Standardwerten und Presets',
          secondary: 'Rohe Shell-Flags',
          secondaryTooltip: {
            title: 'Parameter',
            description:
              'npm reicht zusätzliche Argumente als Strings weiter. Jedes Skript muss sie selbst prüfen.',
          },
        },
        {
          feature: 'Pipelines',
          primary: 'Abhängigkeitsgraphen mit begrenzter Parallelität',
          secondary: 'Sequenzielle Ketten',
          secondaryTooltip: {
            title: 'Kein Abhängigkeitsgraph',
            description:
              'npm run-script kennt keinen Abhängigkeitsgraphen. Für parallele Arbeit braucht es ein separates Tool.',
          },
        },
        {
          feature: 'Services',
          primary: 'Starten, auf Bereitschaft warten, neu starten',
          secondary: 'Nicht enthalten',
        },
        {
          feature: 'Tastaturbedienbare Palette',
          primary: 'Ja, mit ?-Übersicht',
          secondary: 'Keine Terminal-UI',
        },
        {
          feature: 'Sprachen der Oberfläche',
          primary: 'English, Русский, Deutsch, Français, 中文',
          secondary: 'Englisch',
        },
      ],
    },
    faq: {
      heading: 'Fragen',
      items: [
        {
          question: 'Braucht Mink einen Server oder ein Konto?',
          answer:
            'Nein. Mink läuft auf deinem Rechner und liest die Befehle aus deinem Repository.',
        },
        {
          question: 'Passt Mink zu unserem aktuellen Setup?',
          answer:
            'Mink liest package-Skripte, Make-Ziele und Shell-Dateien. Eine mink.yml brauchst du nur, wenn ein Befehl Parameter, einen klareren Namen oder einen Workflow benötigt.',
        },
        {
          question: 'Welche Plattformen werden unterstützt?',
          answer:
            'Windows, Linux und macOS mit Node.js 24 oder neuer. Windows benötigt Windows PowerShell.',
        },
        {
          question: 'Kann ich Mink in meiner Sprache nutzen?',
          answer:
            'Ja. Die Oberfläche gibt es auf Englisch, Russisch, Deutsch, Französisch und Chinesisch. Die Sprache wählst du in den Einstellungen.',
        },
        {
          question: 'Wohin gehen meine Daten?',
          answer: 'Mink läuft lokal. Ein Konto oder ein gehosteter Dienst ist nicht nötig.',
        },
        {
          question: 'Ist Mink produktionsreif?',
          answer:
            'Mink ist Alpha 0.1 unter der MIT-Lizenz. Baue es aus diesem Repository; die Pakete sind noch nicht veröffentlicht.',
        },
      ],
    },
    footer: {
      tagline: 'Jeder Befehl aus deinem Repo in einer Palette.',
      product: 'Produkt',
      docs: 'Dokumentation',
      project: 'Projekt',
      features: 'Funktionen',
      compare: 'Vergleich',
      faq: 'FAQ',
      overview: 'Übersicht',
      quickstart: 'Schnellstart',
      github: 'GitHub',
      issues: 'Issues',
      legal: 'MIT-Lizenz',
      status: 'Alpha 0.1',
    },
  },
  fr: {
    meta: {
      title: 'Mink : palette de commandes pour le terminal',
      description:
        'Trouvez, configurez et lancez les commandes, pipelines et services de votre dépôt depuis une palette de terminal.',
    },
    languageSwitcher: 'Changer de langue',
    nav: {
      features: 'Fonctionnalités',
      compare: 'Comparaison',
      docs: 'Docs',
      faq: 'FAQ',
    },
    hero: {
      titleLead: 'Les commandes de votre dépôt,',
      titleAccent: 'sans fouiller les README.',
      description:
        'Mink trouve les scripts package, les cibles Make et les fichiers shell déjà présents dans votre dépôt. Lancez-les depuis une seule palette de terminal, avec des paramètres typés et un aperçu de ce qui va s’exécuter.',
      primaryCta: 'Lancer Mink',
      secondaryCta: 'Voir comment ça marche',
      agentCta: 'Copier le prompt agent',
      agentCopied: 'Prompt copié',
      installLead: 'Installez une fois, puis lancez',
      imageAlt: 'Acme Checkout dans Mink avec deux services lancés',
    },
    features: {
      heading: 'Construit à partir des fichiers que vous avez déjà.',
      items: [
        {
          title: 'Trouvez ce qui tourne déjà',
          description:
            'Mink lit les scripts package, les cibles Make et les fichiers shell. Pas besoin de déplacer les commandes dans un nouveau fichier de tâches.',
        },
        {
          title: 'Rendez les détails explicites',
          description:
            'Des formulaires typés, des valeurs par défaut et des préréglages permettent à toute l’équipe de lancer la même commande avec les bons paramètres.',
        },
        {
          title: 'Reliez les tâches',
          description:
            'Exécutez des graphes de dépendances avec une concurrence limitée. Les pipelines imbriqués restent lisibles.',
        },
        {
          title: 'Gardez les services à l’œil',
          description:
            'Lancez un service local, attendez qu’il soit prêt, puis redémarrez-le sans quitter la palette.',
        },
        {
          title: 'Le clavier d’abord',
          description: 'Chaque onglet affiche ses propres raccourcis. Appuyez sur ? pour les voir.',
        },
        {
          title: 'Neuf thèmes, cinq langues',
          description:
            'Stone est le thème par défaut. Changez de thème ou de langue dans les réglages, l’effet est immédiat.',
        },
      ],
    },
    problem: {
      heading: 'Un grand dépôt est difficile à faire tourner.',
      description:
        'Des dizaines de scripts et plusieurs README. Les nouveaux devinent quelle commande lancer, et la personne qui sait est souvent occupée.',
      resultNote: 'une palette pour toutes les commandes',
    },
    compare: {
      heading: 'Gardez les scripts. Ajoutez ce qui manque.',
      description:
        'Mink lit les commandes déjà présentes et ajoute des paramètres typés, des graphes de dépendances, des services et une palette pour les retrouver.',
      primaryLabel: 'Mink',
      secondaryLabel: 'scripts npm',
      rows: [
        {
          feature: 'Utilise les commandes déjà dans le dépôt',
          primary: 'Lit les scripts package, les cibles Make et les fichiers shell',
          secondary: 'Seulement les scripts package',
        },
        {
          feature: 'Paramètres typés',
          primary: 'Formulaires avec types, valeurs par défaut et préréglages',
          secondary: 'Options shell brutes',
          secondaryTooltip: {
            title: 'Paramètres',
            description:
              'npm transmet les arguments supplémentaires sous forme de chaînes. Chaque script doit les valider lui-même.',
          },
        },
        {
          feature: 'Pipelines',
          primary: 'Graphes de dépendances avec concurrence limitée',
          secondary: 'Chaînes séquentielles',
          secondaryTooltip: {
            title: 'Pas de graphe de dépendances',
            description:
              'npm run-script n’a pas de graphe de dépendances. Le travail en parallèle demande un outil séparé.',
          },
        },
        {
          feature: 'Services',
          primary: 'Lancer, attendre que le service soit prêt, redémarrer',
          secondary: 'Non inclus',
        },
        {
          feature: 'Palette pilotée au clavier',
          primary: 'Oui, avec l’aide sur ?',
          secondary: 'Pas d’interface terminal',
        },
        {
          feature: 'Langues de l’interface',
          primary: 'English, Русский, Deutsch, Français, 中文',
          secondary: 'Anglais',
        },
      ],
    },
    faq: {
      heading: 'Questions',
      items: [
        {
          question: 'Mink a-t-il besoin d’un serveur ou d’un compte ?',
          answer: 'Non. Mink tourne sur votre machine et lit les commandes de votre dépôt.',
        },
        {
          question: 'Est-ce compatible avec notre configuration actuelle ?',
          answer:
            'Mink lit les scripts package, les cibles Make et les fichiers shell. Un mink.yml n’est nécessaire que si une commande a besoin de paramètres, d’un nom plus clair ou d’un enchaînement.',
        },
        {
          question: 'Quelles plateformes sont prises en charge ?',
          answer:
            'Windows, Linux et macOS avec Node.js 24 ou plus récent. Windows nécessite Windows PowerShell.',
        },
        {
          question: 'Puis-je utiliser Mink dans ma langue ?',
          answer:
            'Oui. L’interface existe en anglais, russe, allemand, français et chinois. La langue se choisit dans les réglages.',
        },
        {
          question: 'Où vont mes données ?',
          answer: 'Mink fonctionne en local. Aucun compte ni service hébergé n’est nécessaire.',
        },
        {
          question: 'Mink est-il prêt pour la production ?',
          answer:
            'Mink est en alpha 0.1 sous licence MIT. Compilez-le depuis ce dépôt ; les paquets ne sont pas encore publiés.',
        },
      ],
    },
    footer: {
      tagline: 'Toutes les commandes de votre dépôt dans une palette.',
      product: 'Produit',
      docs: 'Documentation',
      project: 'Projet',
      features: 'Fonctionnalités',
      compare: 'Comparaison',
      faq: 'FAQ',
      overview: 'Vue d’ensemble',
      quickstart: 'Démarrage rapide',
      github: 'GitHub',
      issues: 'Issues',
      legal: 'Licence MIT',
      status: 'Alpha 0.1',
    },
  },
  zh: {
    meta: {
      title: 'Mink：终端命令面板',
      description: '在一个终端面板里查找、配置并运行仓库中的命令、流水线和服务。',
    },
    languageSwitcher: '切换语言',
    nav: {
      features: '功能',
      compare: '对比',
      docs: '文档',
      faq: '常见问题',
    },
    hero: {
      titleLead: '仓库里的命令，',
      titleAccent: '不用再翻 README。',
      description:
        'Mink 会找出仓库里已有的 package 脚本、Make 目标和 shell 文件。你可以在一个终端面板里运行它们，填写带类型的参数，并先看清将要执行的命令。',
      primaryCta: '运行 Mink',
      secondaryCta: '了解工作方式',
      agentCta: '复制 Agent 提示词',
      agentCopied: '提示词已复制',
      installLead: '安装一次，然后运行',
      imageAlt: 'Mink 中运行着两个服务的 Acme Checkout',
    },
    features: {
      heading: '从仓库里已有的文件开始。',
      items: [
        {
          title: '找到已经在运行的命令',
          description:
            'Mink 会读取 package 脚本、Make 目标和 shell 文件。不需要把命令搬进新的任务文件。',
        },
        {
          title: '把细节说清楚',
          description: '带类型的参数表单、默认值和预设，让每位同事都用正确的值运行同一条命令。',
        },
        {
          title: '把任务连起来',
          description: '用受控的并发运行依赖图。嵌套流水线依然清楚。',
        },
        {
          title: '随时掌握服务状态',
          description: '启动本地服务，等待它就绪，然后不离开面板就能重启。',
        },
        {
          title: '键盘优先',
          description: '每个标签页都有自己的快捷键。按 ? 查看。',
        },
        {
          title: '九种主题，五种语言',
          description: '默认使用 Stone。在设置里切换主题或界面语言，立即生效。',
        },
      ],
    },
    problem: {
      heading: '大仓库不好运行。',
      description: '几十个脚本、好几个 README。新同事只能猜该跑哪条命令，而真正知道的人往往正忙。',
      resultNote: '所有命令，一个面板',
    },
    compare: {
      heading: '保留现有脚本，补上缺的部分。',
      description:
        'Mink 读取你已有的命令，再补上带类型的参数、依赖图、服务，以及一个能找到它们的面板。',
      primaryLabel: 'Mink',
      secondaryLabel: 'npm 脚本',
      rows: [
        {
          feature: '使用仓库里已有的命令',
          primary: '读取 package 脚本、Make 目标和 shell 文件',
          secondary: '仅 package 脚本',
        },
        {
          feature: '带类型的参数',
          primary: '包含类型、默认值和预设的表单',
          secondary: '原始 shell 参数',
          secondaryTooltip: {
            title: '参数',
            description: 'npm 会把额外参数当作字符串传入。每个脚本都要自己校验。',
          },
        },
        {
          feature: '流水线',
          primary: '受控并发的依赖图',
          secondary: '串行链',
          secondaryTooltip: {
            title: '没有依赖图',
            description: 'npm run-script 没有依赖图。并行任务需要另找工具。',
          },
        },
        {
          feature: '服务',
          primary: '启动、等待就绪、重启',
          secondary: '不提供',
        },
        {
          feature: '键盘优先的面板',
          primary: '有，按 ? 查看快捷键',
          secondary: '没有终端界面',
        },
        {
          feature: '界面语言',
          primary: 'English, Русский, Deutsch, Français, 中文',
          secondary: '英语',
        },
      ],
    },
    faq: {
      heading: '常见问题',
      items: [
        {
          question: 'Mink 需要服务器或账号吗？',
          answer: '不需要。Mink 在你自己的机器上运行，读取仓库里的命令。',
        },
        {
          question: '能配合我们现有的配置吗？',
          answer:
            'Mink 会读取 package 脚本、Make 目标和 shell 文件。只有当命令需要参数、更清楚的名字或流程时，才需要添加 mink.yml。',
        },
        {
          question: '支持哪些平台？',
          answer:
            '支持 Windows、Linux 和 macOS，需要 Node.js 24 或更新版本。Windows 需要 Windows PowerShell。',
        },
        {
          question: '可以用中文界面吗？',
          answer: '可以。界面提供英语、俄语、德语、法语和中文。在设置里选择语言即可。',
        },
        {
          question: '我的数据会去哪里？',
          answer: 'Mink 在本地运行，不需要账号，也不需要托管服务。',
        },
        {
          question: 'Mink 可以用于生产环境吗？',
          answer: 'Mink 目前是 alpha 0.1，采用 MIT 许可证。请从这个仓库自行构建；软件包尚未发布。',
        },
      ],
    },
    footer: {
      tagline: '仓库里的所有命令，都在一个面板里。',
      product: '产品',
      docs: '文档',
      project: '项目',
      features: '功能',
      compare: '对比',
      faq: '常见问题',
      overview: '概览',
      quickstart: '快速开始',
      github: 'GitHub',
      issues: 'Issues',
      legal: 'MIT 许可证',
      status: 'Alpha 0.1',
    },
  },
};
