import { handleLocalImage } from '../../utils/localImage'

export default defineEventHandler(event => handleLocalImage(event, '/Users'))
