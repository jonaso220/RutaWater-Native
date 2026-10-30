-- Aprieta Enviar en WhatsApp del Mac para mandar_mensaje (Jonathan, 30/10/2026).
-- El servidor MCP ya abrió el chat con el borrador (whatsapp://send) y dejó el
-- texto esperado en ~/.rutawater-mcp/enviar-whatsapp/texto.txt. Solo aprieta
-- Enviar si WhatsApp está al frente y el campo de escribir tiene exactamente ese
-- texto; si no, no manda nada. El resultado queda en resultado.txt.
-- Lo corre «RutaWater Enviar.app» (enviar-whatsapp-app.applescript), que tiene el
-- permiso de Accesibilidad; este archivo se puede cambiar sin volver a pedirlo.
-- Lo instala instalar-enviar-whatsapp.sh.

on run
	set base to (POSIX path of (path to home folder)) & ".rutawater-mcp/enviar-whatsapp/"
	set outcome to "error: sin resultado"
	set previous to ""
	try
		set expected to read POSIX file (base & "texto.txt") as «class utf8»
		tell application "System Events" to set previous to name of first application process whose frontmost is true
		tell application "WhatsApp" to activate
		delay 1
		tell application "System Events"
			if not UI elements enabled then error "falta el permiso de Accesibilidad" number -25211
			set frontName to name of (first application process whose frontmost is true)
			if frontName is not "WhatsApp" then error "WhatsApp no quedó al frente (" & frontName & ")"
			tell application process "WhatsApp"
				set field to value of attribute "AXFocusedUIElement"
				set draft to value of field
			end tell
			if draft is not expected then error "el borrador no coincide con el mensaje (" & (count characters of draft) & " letras)"
			key code 36
		end tell
		set outcome to "enviado"
		delay 1
	on error message number code
		set outcome to "error " & code & ": " & message
	end try
	try
		if previous is not "" and previous is not "WhatsApp" then tell application "System Events" to set frontmost of application process previous to true
	end try
	set handle to open for access POSIX file (base & "resultado.txt") with write permission
	set eof handle to 0
	write outcome to handle as «class utf8»
	close access handle
end run
