// @ts-check
/**
 * A TypeDoc plugin that splits each category into its groups.
 *
 * Every export in core has a `@category` (its subject, such as Hops) and a
 * `@group` (its role, such as Calculations or Inputs). TypeDoc can nest
 * categories inside groups, but the reference reads better the other way
 * round: one section per subject, with the entry points first. TypeDoc has
 * no option for that, so this plugin defines a theme that renders it.
 *
 * The theme changes two things and leaves the rest of the default theme
 * alone:
 *
 * - The project page lists each category's members under a subheading per
 *   group, in `groupOrder`, after the category description.
 * - The sidebar puts each category's members into one collapsed folder per
 *   group, in the same order.
 *
 * Members whose group isn't named in `groupOrder` (the guides, which are
 * documents) stay at the top of their category without a subheading.
 *
 * Load it with `"plugin": ["./typedoc/group-sections.mjs"]` and
 * `"theme": "beerwright"`.
 */
import { DefaultTheme, DefaultThemeRenderContext, i18n, JSX } from 'typedoc';

const THEME_NAME = 'beerwright';

/**
 * Splits `members` into runs by group, in the order of `groups`, which
 * TypeDoc has already sorted by `groupOrder`. The first run has a null
 * title and holds the members whose group isn't named in `groupOrder`.
 * Empty runs are dropped.
 *
 * @template T
 * @param {readonly T[]} members
 * @param {readonly { title: string, children: readonly unknown[] }[] | undefined} groups
 * @param {readonly string[]} namedGroups
 * @returns {{ title: string | null, members: T[] }[]}
 */
function splitByGroup(members, groups, namedGroups) {
  const ungrouped = { title: null, members: /** @type {T[]} */ ([]) };
  const runs = (groups ?? [])
    .filter((group) => namedGroups.includes(group.title))
    .map((group) => ({
      title: group.title,
      members: members.filter((member) => group.children.includes(member)),
    }));
  const grouped = new Set(runs.flatMap((run) => run.members));
  ungrouped.members = members.filter((member) => !grouped.has(member));
  return [ungrouped, ...runs].filter((run) => run.members.length > 0);
}

/**
 * The groups named in `groupOrder`, without the `*` wildcard.
 *
 * @param {import('typedoc').Options} options
 */
function namedGroups(options) {
  return options.getValue('groupOrder').filter((title) => title !== '*');
}

/**
 * A permalink icon beside a heading, as the default theme draws it.
 *
 * @param {DefaultThemeRenderContext} context
 * @param {string} anchor
 */
function anchorIcon(context, anchor) {
  return JSX.createElement(
    'a',
    { href: `#${anchor}`, 'aria-label': i18n.theme_permalink(), class: 'tsd-anchor-icon' },
    context.icons.anchor(),
  );
}

class GroupSectionsContext extends DefaultThemeRenderContext {
  /** The default theme's project and module page. */
  #defaultModuleReflection = this.moduleReflection;

  /**
   * The project and module page. A reflection with categories gets the
   * default theme's layout with one change: each category's member list is
   * split into a list per group, each under its own subheading. Anything
   * else gets the default page.
   *
   * @param {import('typedoc').DeclarationReflection | import('typedoc').ProjectReflection} mod
   */
  moduleReflection = (mod) => {
    if (!mod.categories?.length) return this.#defaultModuleReflection(mod);
    const h = JSX.createElement;
    const named = namedGroups(this.options);

    /** @param {(import('typedoc').DeclarationReflection | import('typedoc').DocumentReflection)[]} members */
    const summaries = (members) =>
      h(
        'dl',
        { class: 'tsd-member-summaries' },
        members.map((member) => this.moduleMemberSummary(member)),
      );

    /** @param {import('typedoc').ReflectionCategory} category */
    const categoryBody = (category) =>
      h(
        JSX.Fragment,
        null,
        category.description?.length
          ? h(
              'div',
              { class: 'tsd-comment tsd-typography' },
              h(JSX.Raw, { html: this.markdown(category.description) }),
            )
          : null,
        splitByGroup(category.children, mod.groups, named).map((run) => {
          if (run.title === null) return summaries(run.members);
          const anchor = this.slugger.slug(`${category.title} ${run.title}`);
          return h(
            'section',
            { class: 'bw-group-section' },
            h(
              'h3',
              { class: 'bw-group-heading tsd-anchor-link', id: anchor },
              run.title,
              anchorIcon(this, anchor),
            ),
            summaries(run.members),
          );
        }),
      );

    return h(
      JSX.Fragment,
      null,
      mod.hasComment(this.options.getValue('notRenderedTags'))
        ? h(
            'section',
            { class: 'tsd-panel tsd-comment' },
            this.commentSummary(mod),
            this.commentTags(mod),
          )
        : null,
      mod.isDeclaration() && mod.readme?.length
        ? h(
            'section',
            { class: 'tsd-panel tsd-typography' },
            h(JSX.Raw, { html: this.markdown(mod.readme) }),
          )
        : null,
      mod.categories.map((category) => {
        if (category.children.length === 0) return null;
        // TypeDoc's name for the members that have no category.
        if (category.title.toLocaleLowerCase() === 'none') {
          return h(
            'section',
            { class: 'tsd-panel-group tsd-member-group' },
            categoryBody(category),
          );
        }
        this.page.startNewSection(category.title);
        const anchor = this.slugger.slug(category.title);
        return h(
          'details',
          { class: 'tsd-panel-group tsd-member-group tsd-accordion', open: true },
          h(
            'summary',
            { class: 'tsd-accordion-summary', 'data-key': `section-${category.title}` },
            this.icons.chevronDown(),
            h(
              'h2',
              { class: 'tsd-anchor-link', id: anchor },
              category.title,
              anchorIcon(this, anchor),
            ),
          ),
          categoryBody(category),
        );
      }),
    );
  };
}

class GroupSectionsTheme extends DefaultTheme {
  ContextClass = GroupSectionsContext;

  /**
   * The default sidebar, with each category's members moved into a folder
   * per group. Folders without a link start collapsed, and the one holding
   * the current page opens.
   *
   * @param {import('typedoc').ProjectReflection} project
   */
  buildNavigation(project) {
    const navigation = super.buildNavigation(project);
    const categories = project.categories ?? [];
    const named = namedGroups(this.application.options);

    // Sidebar entries carry a URL, not a reflection, so members are matched
    // to their group by URL.
    /** @type {Map<string, unknown>} */
    const byUrl = new Map();
    for (const category of categories) {
      for (const member of category.children) {
        if (this.router.hasUrl(member)) byUrl.set(this.router.getFullUrl(member), member);
      }
    }

    return navigation.map((node) => {
      if (node.path || !node.children) return node;
      if (!categories.some((category) => category.title === node.text)) return node;
      const children = node.children;
      const members = children.map((child) => (child.path ? byUrl.get(child.path) : undefined));
      const runs = splitByGroup(
        members.filter((member) => member !== undefined),
        project.groups,
        named,
      );
      const navFor = (/** @type {unknown} */ member) => children[members.indexOf(member)];
      return {
        ...node,
        children: [
          ...children.filter((_, i) => members[i] === undefined),
          ...runs.flatMap((run) =>
            run.title === null
              ? run.members.map(navFor)
              : [{ text: run.title, children: run.members.map(navFor) }],
          ),
        ],
      };
    });
  }
}

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.renderer.defineTheme(THEME_NAME, GroupSectionsTheme);
}
