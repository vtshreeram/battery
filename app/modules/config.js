// Central repository configuration and identity
const REPOSITORY_OWNER = 'vtshreeram'
const REPOSITORY_NAME = 'battery'
const DEFAULT_BRANCH = 'main'

const REPOSITORY_URL = `https://github.com/${ REPOSITORY_OWNER }/${ REPOSITORY_NAME }`
const REPOSITORY_RAW_BASE = `https://raw.githubusercontent.com/${ REPOSITORY_OWNER }/${ REPOSITORY_NAME }/${ DEFAULT_BRANCH }`

module.exports = {
    REPOSITORY_OWNER,
    REPOSITORY_NAME,
    DEFAULT_BRANCH,
    REPOSITORY_URL,
    REPOSITORY_RAW_BASE,
    URL_SETUP_SH: `${ REPOSITORY_RAW_BASE }/setup.sh`,
    URL_UPDATE_SH: `${ REPOSITORY_RAW_BASE }/update.sh`,
    URL_BATTERY_SH: `${ REPOSITORY_RAW_BASE }/battery.sh`,
    URL_RELEASES: `${ REPOSITORY_URL }/releases`,
    URL_ISSUES: `${ REPOSITORY_URL }/issues`,
    URL_README: `${ REPOSITORY_URL }#readme`,
    URL_CLI_DOCS: `${ REPOSITORY_URL }#-command-line-version`
}
