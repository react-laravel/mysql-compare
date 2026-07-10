import { IPC } from '../../shared/ipc-channels'
import type {
  SSHCreateDirectoryRequest,
  SSHDeleteFileRequest,
  SSHDownloadDirectoryRequest,
  SSHDownloadFileRequest,
  SSHListFilesRequest,
  SSHMoveFileRequest,
  SSHTerminalCloseRequest,
  SSHTerminalCreateRequest,
  SSHTerminalResizeRequest,
  SSHTerminalWriteRequest,
  SSHReadFileRequest,
  SSHUploadDirectoryRequest,
  SSHUploadEntriesRequest,
  SSHUploadFileRequest,
  SSHWriteFileRequest,
} from '../../shared/types'
import { sshFileService } from '../services/ssh-file-service'
import { sshTerminalService } from '../services/ssh-terminal-service'
import { handle } from './_wrap'

export function registerSSHIPC(): void {
  handle(IPC.SSHListFiles, (payload: SSHListFilesRequest) => sshFileService.listFiles(payload))
  handle(IPC.SSHUploadFile, (payload: SSHUploadFileRequest) => sshFileService.uploadFile(payload))
  handle(IPC.SSHUploadDirectory, (payload: SSHUploadDirectoryRequest) => sshFileService.uploadDirectory(payload))
  handle(IPC.SSHUploadEntries, (payload: SSHUploadEntriesRequest) => sshFileService.uploadEntries(payload))
  handle(IPC.SSHDownloadFile, (payload: SSHDownloadFileRequest) => sshFileService.downloadFile(payload))
  handle(IPC.SSHDownloadDirectory, (payload: SSHDownloadDirectoryRequest) => sshFileService.downloadDirectory(payload))
  handle(IPC.SSHReadFile, (payload: SSHReadFileRequest) => sshFileService.readFile(payload))
  handle(IPC.SSHWriteFile, (payload: SSHWriteFileRequest) => sshFileService.writeFile(payload))
  handle(IPC.SSHCreateDirectory, (payload: SSHCreateDirectoryRequest) => sshFileService.createDirectory(payload))
  handle(IPC.SSHDeleteFile, (payload: SSHDeleteFileRequest) => sshFileService.deleteFile(payload))
  handle(IPC.SSHMoveFile, (payload: SSHMoveFileRequest) => sshFileService.moveFile(payload))
  handle(IPC.SSHTerminalCreate, (payload: SSHTerminalCreateRequest, event) =>
    sshTerminalService.createSession(payload, {
      onData: (terminalEvent) => event.sender.send(IPC.SSHTerminalData, terminalEvent),
      onExit: (terminalEvent) => event.sender.send(IPC.SSHTerminalExit, terminalEvent)
    }, `electron:${event.sender.id}`)
  )
  handle(IPC.SSHTerminalWrite, (payload: SSHTerminalWriteRequest, event) =>
    sshTerminalService.write(payload, `electron:${event.sender.id}`))
  handle(IPC.SSHTerminalResize, (payload: SSHTerminalResizeRequest, event) =>
    sshTerminalService.resize(payload, `electron:${event.sender.id}`))
  handle(IPC.SSHTerminalClose, (payload: SSHTerminalCloseRequest, event) =>
    sshTerminalService.close(payload, `electron:${event.sender.id}`))
}
